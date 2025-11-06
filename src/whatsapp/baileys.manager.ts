import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import QRCode from 'qrcode';
import axios from 'axios';
// @whiskeysockets/baileys is ESM-only. Use dynamic import at runtime to avoid
// `require()` of an ES module when running ts-node-dev (CommonJS loader).
// We'll import the needed symbols dynamically inside createSession().
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

export type BaileysSession = {
  sessionId: string;
  userId: string;
  phoneNumber: string;
  qr?: string; // PNG data URL (data:image/png;base64,...)
  connected: boolean;
  sessionFile?: string; // file path where auth state is stored
  sessionData?: string | null; // serialized auth file contents
};

export type IncomingMessage = {
  messageId: string;
  from: string;
  to: string;
  type: string; // 'text', 'image', 'audio', etc.
  content?: string; // text content or metadata for non-text types
  timestamp: number; // Unix timestamp
  [key: string]: unknown; // additional properties
};

type InternalSession = {
  sock: any;
  filePath: string;
};

@Injectable()
export class BaileysManager {
  private readonly logger = new Logger(BaileysManager.name);
  private sessions = new Map<string, InternalSession>();
  // public event emitter to notify about socket lifecycle events
  public events = new EventEmitter();

  private sessionsDir = path.resolve(process.cwd(), 'sessions');

  constructor() {
    try {
      if (!fs.existsSync(this.sessionsDir)) fs.mkdirSync(this.sessionsDir, { recursive: true });
    } catch (err) {
      this.logger.error('Failed to create sessions dir', err as any);
    }
  }

  /**
   * Restore all existing session directories found on disk.
   * This should be invoked at application startup to rehydrate in-memory sockets.
   */
  async restoreAllSessions(): Promise<void> {
    try {
      const files = await fsp.readdir(this.sessionsDir);
      for (const f of files) {
        const full = path.join(this.sessionsDir, f);
        try {
          const st = await fsp.stat(full);
          if (st.isDirectory() || f.endsWith('.json')) {
            // session directories are created as sessionId folder; some implementations store creds as files
            // normalize sessionDirName to directory name (if file, strip extension)
            const sessionDirName = st.isDirectory() ? f : f.replace(/\.json$/i, '');
            // try to read creds or session info to infer phoneNumber/userId where possible
            // We don't have userId readily here; we'll infer userId from sessionDirName prefix
            // sessionDirName is created as `${userId}-${timestamp}` where userId is a UUID
            // Avoid taking only the first dash-separated segment which yields an invalid UUID like 'ef0febb4'
            let userId = sessionDirName;
            if (sessionDirName.length >= 36) {
              const possible = sessionDirName.substring(0, 36);
              const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
              if (uuidRe.test(possible)) {
                userId = possible;
              }
            } else {
              // fallback: keep original (may be non-uuid identifier)
              userId = sessionDirName;
            }
            // best-effort phoneNumber empty string; the restored socket will emit connected with phoneNumber
            await this.restoreSocketFromDir(sessionDirName, userId, '');
          }
        } catch (e) {
          // ignore per-session errors
          this.logger.warn(`Skipping session entry ${f} during restoreAllSessions`, e as any);
        }
      }
      this.logger.log('restoreAllSessions: completed');
    } catch (e) {
      this.logger.error('restoreAllSessions failed', e as any);
    }
  }

  async createSession(userId: string, phoneNumber: string): Promise<BaileysSession> {
    const sessionId = `${userId}-${Date.now()}`;
    const sessionDir = path.join(this.sessionsDir, sessionId);

    // Dynamically import the ESM Baileys package at runtime so ts-node-dev
    // (which runs in a CommonJS context) doesn't try to require() the module.
    // Use eval to prevent TypeScript from transforming the import() call.
    const baileys = await eval("import('@whiskeysockets/baileys')");
    // Resolve exports (some builds export a default, some named)
    const makeWASocket = (baileys.default || baileys.makeWASocket) as any;
    const useMultiFileAuthState = baileys.useMultiFileAuthState as any;
    const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion as any;
    const makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore as any;
    const DisconnectReason = baileys.DisconnectReason as any;

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    this.logger.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

    // Baileys sometimes calls logger.trace / logger.xxx. Nest Logger doesn't
    // implement `trace`, so provide a small shim that maps expected methods to
    // Nest logger methods to avoid runtime TypeError: logger?.trace is not a function
    const baileysLogger = {
      trace: (...args: any[]) => this.logger.debug(String(args && args.length ? args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') : '')),
      debug: (...args: any[]) => this.logger.debug(String(args && args.length ? args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') : '')),
      info: (...args: any[]) => this.logger.log(String(args && args.length ? args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') : '')),
      warn: (...args: any[]) => this.logger.warn(String(args && args.length ? args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') : '')),
      error: (...args: any[]) => this.logger.error(String(args && args.length ? args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') : '')),
    } as any;

    // We'll create the socket via a helper to allow reconnection attempts
    let promiseResolved = false;
    const maxReconnectAttempts = 3;
    let reconnectAttempts = 0;
    let qrEmitted = false;
    let connectedEmitted = false;

    // helper to (re)create the socket and wire handlers
    const createSocket = async (): Promise<any> => {
      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          // pass a logger shim to avoid missing `trace` method errors
          keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        printQRInTerminal: false,
        version,
        browser: ['Baileys', 'Chrome', '4.0.0'],
      });

      // store latest socket
      this.sessions.set(sessionId, { sock, filePath: sessionDir });

      sock.ev.on('connection.update', async (update: any) => {
        // log full update for debugging
        this.logger.debug({ msg: 'connection.update', sessionId, update } as any);

        const { connection, qr } = update as any;
        try {
          if (qr && !qrEmitted) {
            try {
              this.logger.log(`Received QR for session ${sessionId}: [length=${String(qr).length}]`);
              await fsp.mkdir(sessionDir, { recursive: true });
              await fsp.writeFile(path.join(sessionDir, 'qr.txt'), String(qr), 'utf8');
              await QRCode.toFile(path.join(sessionDir, 'qr.png'), qr, { type: 'png' });
            } catch (saveErr) {
              this.logger.warn('Failed to save QR files', saveErr as any);
            }

            qrEmitted = true;
            // Resolve promise early with QR code
            if (!promiseResolved) {
              try {
                const dataUrl = await QRCode.toDataURL(qr, { type: 'image/png' });
                promiseResolved = true;
                // Don't resolve here, wait for creds file or QR image
              } catch (e) {
                this.logger.warn('QR generation error', e as any);
              }
            }
          }

          if (connection === 'open') {
            try {
              await saveCreds();
            } catch (e) {
              this.logger.warn('saveCreds error', e as any);
            }

            let fileContents: string | null = null;
            const credsPath = path.join(sessionDir, 'creds.json');
            try {
              fileContents = await fsp.readFile(credsPath, 'utf8');
            } catch (e) {
              this.logger.warn('Failed to read session creds file', e as any);
            }

            if (!connectedEmitted) {
              connectedEmitted = true;
              // IMPORTANT: Emit connected event - this MUST be done BEFORE resolving the promise
              // so that WhatsappService listeners can update DB before the response is sent
              try {
                this.logger.log(`Emitting connected for sessionId=${sessionId} userId=${userId}`);
                this.events.emit('connected', { sessionId, userId, fileContents, phoneNumber });
              } catch (e) {
                this.logger.warn('events.connected handler threw', e as any);
              }
            }
          }

          if (connection === 'close') {
            const statusCode = (update?.lastDisconnect?.error as Boom)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            this.logger.log(`Connection closed for ${sessionId}, statusCode=${statusCode}, shouldReconnect=${shouldReconnect}`);

            if (shouldReconnect && reconnectAttempts < maxReconnectAttempts) {
              reconnectAttempts += 1;
              const backoff = 2000 * reconnectAttempts;
              this.logger.warn(`Session ${sessionId} will attempt reconnection #${reconnectAttempts} in ${backoff}ms`);
              setTimeout(async () => {
                try {
                  // close previous socket if possible
                  try { if (sock && typeof sock.ws === 'object' && typeof sock.ws.close === 'function') sock.ws.close(); } catch (e) {}
                } catch (e) {}
                try {
                  await createSocket();
                } catch (e) {
                  this.logger.error(`Reconnection attempt #${reconnectAttempts} failed for ${sessionId}`, e as any);
                }
              }, backoff);
            } else {
              this.logger.log(`Session ${sessionId} logged out or max reconnection attempts reached, cleaning up`);
              // emit disconnected so DB can be updated
              try {
                this.logger.log(`Emitting disconnected for sessionId=${sessionId} userId=${userId} statusCode=${statusCode}`);
                this.events.emit('disconnected', { sessionId, userId, statusCode, phoneNumber });
              } catch (e) {
                this.logger.warn('events.disconnected handler threw', e as any);
              }
              this.sessions.delete(sessionId);
            }
          }
        } catch (err) {
          this.logger.error('Error handling connection.update', err as any);
        }
      });

      // wire error events for visibility
      sock.ev.on('connection.error', (err: any) => {
        this.logger.error({ msg: 'connection.error', sessionId, err } as any);
      });

      // wire message events to emit incoming messages
      sock.ev.on('messages.upsert', (msg: any) => {
        try {
          if (!msg || !msg.messages || msg.messages.length === 0) {
            return;
          }

          // Filter for incoming messages only
          for (const message of msg.messages) {
            if (message.key.fromMe) {
              // Skip outgoing messages
              continue;
            }

            const incomingMsg: IncomingMessage = {
              messageId: message.key.id,
              from: message.key.remoteJid || '',
              to: state?.creds?.me?.id || phoneNumber,
              type: message.message ? Object.keys(message.message)[0] : 'unknown',
              timestamp: message.messageTimestamp || Date.now(),
            };

            // Extract text content if available
            if (message.message?.conversation) {
              incomingMsg.content = message.message.conversation;
            } else if (message.message?.extendedTextMessage?.text) {
              incomingMsg.content = message.message.extendedTextMessage.text;
            } else if (message.message?.imageMessage?.caption) {
              incomingMsg.content = message.message.imageMessage.caption;
            } else if (message.message?.videoMessage?.caption) {
              incomingMsg.content = message.message.videoMessage.caption;
            }

            // Emit the incoming message event
            this.logger.debug(`Emitting incoming message: ${incomingMsg.messageId}`);
            this.events.emit('message', {
              sessionId,
              userId,
              phoneNumber,
              message: incomingMsg,
            });
          }
        } catch (err) {
          this.logger.warn('Error processing messages.upsert event', err as any);
        }
      });

      return sock;
    };

    // Single attempt with a 120s timeout for connection establishment
    return new Promise<BaileysSession>(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!promiseResolved) {
          this.logger.warn(`Connection timeout for session ${sessionId}`);
          promiseResolved = true;
          reject(new Error('Connection timeout'));
        }
      }, 120_000); // 120s to allow connection attempt

      // create initial socket
      try {
        const initialSock = await createSocket();
        
        // Poll filesystem for either QR file or credentials file
        const watcher = setInterval(async () => {
          if (promiseResolved) {
            clearInterval(watcher);
            clearTimeout(timeout);
            return;
          }

          // check creds file to decide connected state
          const credsPath = path.join(sessionDir, 'creds.json');
          const pngPath = path.join(sessionDir, 'qr.png');
          
          try {
            const fileContents = await fsp.readFile(credsPath, 'utf8');
            promiseResolved = true;
            clearInterval(watcher);
            clearTimeout(timeout);
            resolve({ sessionId, userId, phoneNumber, qr: undefined, connected: true, sessionFile: sessionDir, sessionData: fileContents });
            return;
          } catch (e) {
            // creds not ready yet
          }

          // if creds not present but qr.png is present, return qr
          try {
            if (fs.existsSync(pngPath)) {
              const image = await fsp.readFile(pngPath);
              const dataUrl = `data:image/png;base64,${image.toString('base64')}`;
              promiseResolved = true;
              clearInterval(watcher);
              clearTimeout(timeout);
              resolve({ sessionId, userId, phoneNumber, qr: dataUrl, connected: false, sessionFile: sessionDir, sessionData: null });
              return;
            }
          } catch (e) {
            // ignore
          }
        }, 500);
      } catch (err) {
        clearTimeout(timeout);
        promiseResolved = true;
        reject(err as any);
      }
    });
  }

  async disconnect(sessionId: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      // try to remove session file if exists
      const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
      try {
        if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
      } catch (e) {
        this.logger.warn('Failed to cleanup session file', e as any);
      }
      return false;
    }

    try {
      const sock = entry.sock;
      // attempt graceful logout
      if (sock && typeof sock.logout === 'function') {
        try {
          await sock.logout();
        } catch (e) {
          // ignore
        }
      }
      // close socket
      if (sock && typeof sock.ws === 'object' && typeof sock.ws.close === 'function') {
        try { sock.ws.close(); } catch (e) {}
      }

      // remove session file
      try { if (fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath); } catch (e) {}

      this.sessions.delete(sessionId);
      return true;
    } catch (err) {
      this.logger.warn('Error during disconnect', err as any);
      return false;
    }
  }

  async getSessionByUser(userId: string): Promise<BaileysSession | null> {
    // search sessions dir for files matching prefix userId-
    try {
      const files = await fsp.readdir(this.sessionsDir);
      for (const f of files) {
        if (f.startsWith(`${userId}-`) && f.endsWith('.json')) {
          const filePath = path.join(this.sessionsDir, f);
          const contents = await fsp.readFile(filePath, 'utf8');
          return { sessionId: f.replace('.json',''), userId, phoneNumber: '', qr: undefined, connected: true, sessionFile: filePath, sessionData: contents };
        }
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  async getSession(sessionId: string): Promise<BaileysSession | null> {
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    try {
      const contents = await fsp.readFile(filePath, 'utf8');
      return { sessionId, userId: sessionId.split('-')[0], phoneNumber: '', qr: undefined, connected: true, sessionFile: filePath, sessionData: contents };
    } catch (e) {
      return null;
    }
  }

  /**
   * Attempt to restore an existing session from an auth directory and create an in-memory socket.
   * This helps when the application restarts and session files exist on disk but no socket is active in memory.
   */
  private async restoreSocketFromDir(sessionDirName: string, userId: string, phoneNumber: string): Promise<boolean> {
    const sessionDir = path.join(this.sessionsDir, sessionDirName);
    try {
      // dynamic import of baileys similar to createSession
      const baileys = await eval("import('@whiskeysockets/baileys')");
      const makeWASocket = (baileys.default || baileys.makeWASocket) as any;
      const useMultiFileAuthState = baileys.useMultiFileAuthState as any;
      const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion as any;
      const makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore as any;
      const DisconnectReason = baileys.DisconnectReason as any;

      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      const { version } = await fetchLatestBaileysVersion();

      const baileysLogger = {
        trace: (...args: any[]) => this.logger.debug(String(args && args.length ? args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') : '')),
        debug: (...args: any[]) => this.logger.debug(String(args && args.length ? args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') : '')),
        info: (...args: any[]) => this.logger.log(String(args && args.length ? args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') : '')),
        warn: (...args: any[]) => this.logger.warn(String(args && args.length ? args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') : '')),
        error: (...args: any[]) => this.logger.error(String(args && args.length ? args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') : '')),
      } as any;

      const sock = makeWASocket({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
        printQRInTerminal: false,
        version,
        browser: ['Baileys', 'Chrome', '4.0.0'],
      });

      // store socket
      this.sessions.set(sessionDirName, { sock, filePath: sessionDir });

      // minimal event wiring: connection updates and incoming messages
      sock.ev.on('connection.update', async (update: any) => {
        try {
          const { connection } = update as any;
          if (connection === 'open') {
            try { await saveCreds(); } catch (e) { this.logger.warn('saveCreds error during restore', e as any); }
            this.logger.log(`Restored and connected session ${sessionDirName} for user ${userId}`);
            this.events.emit('connected', { sessionId: sessionDirName, userId, fileContents: null, phoneNumber });
          }

          if (connection === 'close') {
            const statusCode = (update?.lastDisconnect?.error as Boom)?.output?.statusCode;
            this.logger.log(`Restored session ${sessionDirName} closed, status=${statusCode}`);
            this.events.emit('disconnected', { sessionId: sessionDirName, userId, statusCode, phoneNumber });
            this.sessions.delete(sessionDirName);
          }
        } catch (err) {
          this.logger.error('Error in restore connection.update', err as any);
        }
      });

      sock.ev.on('connection.error', (err: any) => {
        this.logger.error({ msg: 'restore connection.error', sessionId: sessionDirName, err } as any);
      });

      sock.ev.on('messages.upsert', (msg: any) => {
        try {
          if (!msg || !msg.messages || msg.messages.length === 0) return;
          for (const message of msg.messages) {
            if (message.key.fromMe) continue;
            const incomingMsg: IncomingMessage = {
              messageId: message.key.id,
              from: message.key.remoteJid || '',
              to: state?.creds?.me?.id || phoneNumber,
              type: message.message ? Object.keys(message.message)[0] : 'unknown',
              timestamp: message.messageTimestamp || Date.now(),
            };
            if (message.message?.conversation) incomingMsg.content = message.message.conversation;
            else if (message.message?.extendedTextMessage?.text) incomingMsg.content = message.message.extendedTextMessage.text;
            else if (message.message?.imageMessage?.caption) incomingMsg.content = message.message.imageMessage.caption;
            else if (message.message?.videoMessage?.caption) incomingMsg.content = message.message.videoMessage.caption;

            this.logger.debug(`Emitting incoming message (restored): ${incomingMsg.messageId}`);
            this.events.emit('message', { sessionId: sessionDirName, userId, phoneNumber, message: incomingMsg });
          }
        } catch (err) {
          this.logger.warn('Error processing messages.upsert in restored socket', err as any);
        }
      });

      return true;
    } catch (err) {
      this.logger.warn('Failed to restore socket from dir', sessionDirName, err as any);
      return false;
    }
  }

  /**
   * Build a Baileys-compatible payload from our MessageType/content shape.
   */
  private buildPayloadForBaileys(type: string, content: any): any {
    switch ((type || '').toLowerCase()) {
      case 'image':
        return { image: { url: content?.mediaUrl }, caption: content?.caption };
      case 'video':
        return { video: { url: content?.mediaUrl }, caption: content?.caption };
      case 'audio':
        return { audio: { url: content?.mediaUrl } };
      case 'document':
        return { document: { url: content?.mediaUrl }, fileName: content?.caption || 'file' };
      case 'sticker':
        return { sticker: { url: content?.mediaUrl } };
      case 'location':
        return {
          location: {
            degreesLatitude: content?.latitude || 0,
            degreesLongitude: content?.longitude || 0,
          },
        };
      case 'contact':
        // send as vcard contact message when possible
        if (content?.name && content?.phone) {
          const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${String(content.name)}\nTEL:${String(content.phone)}\nEND:VCARD`;
          return { contacts: { displayName: content.name, contacts: [{ vcard }] } };
        }
        return { text: content?.text || '' };
      case 'text':
      default:
        return { text: content?.text || '' };
    }
  }

  /**
   * Download a media URL and return { data: Buffer, mimeType, fileName }
   */
  private async fetchMediaAsBuffer(url: string): Promise<{ data: Buffer; mimeType?: string; fileName?: string }> {
    const attempts = [
      { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': '*/*', 'Referer': 'https://file-examples.com/' },
      { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': '*/*' },
      { 'User-Agent': 'wabr/1.0', 'Accept': '*/*' },
    ];

    for (const hdrs of attempts) {
      try {
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000, maxRedirects: 10, headers: hdrs, validateStatus: (s) => s >= 200 && s < 400 });
        const data = Buffer.from(res.data);
        const mimeType = res.headers['content-type'];
        // derive filename from URL path
        let fileName: string | undefined = undefined;
        try {
          const parsed = new URL(url);
          const pathname = parsed.pathname || '';
          const name = pathname.split('/').pop();
          if (name) fileName = name;
        } catch (e) {
          // ignore
        }
        return { data, mimeType, fileName };
      } catch (err) {
        const status = (err as any)?.response?.status;
        this.logger.warn(`fetchMediaAsBuffer attempt failed for ${url} status=${status} ua=${String(hdrs['User-Agent'])} msg=${(err as any)?.message}`);
        // if 403 try next header set, otherwise continue to next attempt
        if (status && status !== 403) {
          // for non-403 errors, try next attempt as well
          continue;
        }
        // if 403, try next header set; if last attempt, throw
      }
    }

    this.logger.error(`fetchMediaAsBuffer error for ${url}: all attempts failed`);
    throw new Error(`Failed to fetch stream from ${url}`);
  }

  /**
   * Replace remote URL entries in payload with Buffer-based media so Baileys doesn't need to fetch.
   */
  private async resolveRemoteMedia(payload: any): Promise<any> {
    if (!payload || typeof payload !== 'object') return payload;
    const mediaKeys = ['image', 'video', 'audio', 'document', 'sticker'];
    for (const key of mediaKeys) {
      const entry = payload[key];
      if (entry && typeof entry === 'object' && entry.url) {
        const url = entry.url;
        // download
        const media = await this.fetchMediaAsBuffer(url);
        // replace url with buffer
        payload[key] = media.data;
        // attach mimetype if available
        if (media.mimeType) payload.mimetype = media.mimeType;
        // ensure fileName for documents
        if (key === 'document') payload.fileName = payload.fileName || media.fileName || 'file';
        return payload;
      }
    }
    return payload;
  }

  /**
   * Send a message (supports multiple types) using the socket associated with a given userId.
   * It searches active in-memory sessions first (created via createSession),
   * then attempts to match by session files on disk.
   */
  async sendMessage(userId: string, to: string, type: string, content: any): Promise<{ id?: string; ok: boolean; error?: string }> {
    // find in-memory session whose filePath contains the userId prefix
    for (const [sessionId, info] of this.sessions.entries()) {
      if (info.filePath.includes(`${userId}-`)) {
        const sock = info.sock;
        if (!sock) return { ok: false, error: 'socket-not-available' };
        try {
          let payload = this.buildPayloadForBaileys(type, content);
          // If payload contains remote URLs for media, try to download them and convert to Buffers
          try {
            payload = await this.resolveRemoteMedia(payload);
          } catch (e) {
            this.logger.warn(`Failed to resolve remote media for send: ${(e as any)?.message}`);
            // propagate error so caller knows media couldn't be fetched
            throw e;
          }
          // Baileys send API differs between versions; attempt common forms
          if (typeof sock.sendMessage === 'function') {
            const res = await sock.sendMessage(to, payload);
            const key = res?.key?.id || (res?.messages && res.messages[0]?.key?.id) || undefined;
            return { ok: true, id: key };
          }
          if (typeof sock.send === 'function') {
            const text = payload?.text || '';
            await sock.send({ conversation: text }, to);
            return { ok: true };
          }
          return { ok: false, error: 'unsupported-socket-api' };
        } catch (err: any) {
          this.logger.error('sendMessage error', err?.stack ?? err);
          return { ok: false, error: String(err?.message ?? err) };
        }
      }
    }

    // fallback: try to locate session directory on disk and attempt to restore socket
    try {
      const files = await fsp.readdir(this.sessionsDir);
      for (const f of files) {
        if (f.startsWith(`${userId}-`)) {
          // attempt to restore socket from this session directory
          try {
            const restored = await this.restoreSocketFromDir(f, userId, to);
            if (restored) {
              // try sending again using restored socket
              const entry = this.sessions.get(f);
              if (entry && entry.sock) {
                const sock = entry.sock;
                try {
                  let payload = this.buildPayloadForBaileys(type, content);
                  try {
                    payload = await this.resolveRemoteMedia(payload);
                  } catch (e) {
                    this.logger.warn(`Failed to resolve remote media for send after restore: ${(e as any)?.message}`);
                    throw e;
                  }
                  if (typeof sock.sendMessage === 'function') {
                    const res = await sock.sendMessage(to, payload);
                    const key = res?.key?.id || (res?.messages && res.messages[0]?.key?.id) || undefined;
                    return { ok: true, id: key };
                  }
                  if (typeof sock.send === 'function') {
                    const text = payload?.text || '';
                    await sock.send({ conversation: text }, to);
                    return { ok: true };
                  }
                  return { ok: false, error: 'unsupported-socket-api' };
                } catch (err: any) {
                  this.logger.error('sendMessage error after restore', err?.stack ?? err);
                  return { ok: false, error: String(err?.message ?? err) };
                }
              }
            }
          } catch (e) {
            this.logger.warn('Failed to restore session while sending message', e as any);
            return { ok: false, error: 'no-active-socket' };
          }

          // if not restored, report no-active-socket
          return { ok: false, error: 'no-active-socket' };
        }
      }
    } catch (e) {
      // ignore
    }

    return { ok: false, error: 'session-not-found' };
  }

  /**
   * Get socket for a userId (used for direct message operations)
   */
  async getSocketForUser(userId: string): Promise<any | null> {
    // find in-memory session
    for (const [sessionId, info] of this.sessions.entries()) {
      if (info.filePath.includes(`${userId}-`)) {
        return info.sock || null;
      }
    }

    // try to restore from disk
    try {
      const files = await fsp.readdir(this.sessionsDir);
      for (const f of files) {
        if (f.startsWith(`${userId}-`)) {
          const restored = await this.restoreSocketFromDir(f, userId, '');
          if (restored) {
            const entry = this.sessions.get(f);
            return entry?.sock || null;
          }
        }
      }
    } catch (e) {
      this.logger.warn('Failed to get socket for user', e as any);
    }

    return null;
  }
}

// Keep this for compatibility - old sendMessage signature is still above
