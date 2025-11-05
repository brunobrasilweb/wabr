import { Injectable, Logger } from '@nestjs/common';
import QRCode from 'qrcode';
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

type InternalSession = {
  sock: any;
  filePath: string;
};

@Injectable()
export class BaileysManager {
  private readonly logger = new Logger(BaileysManager.name);
  private sessions = new Map<string, InternalSession>();

  private sessionsDir = path.resolve(process.cwd(), 'sessions');

  constructor() {
    try {
      if (!fs.existsSync(this.sessionsDir)) fs.mkdirSync(this.sessionsDir, { recursive: true });
    } catch (err) {
      this.logger.error('Failed to create sessions dir', err as any);
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

    // We'll create the socket via a helper to allow reconnection attempts
    let resolved = false;
    const maxReconnectAttempts = 3;
    let reconnectAttempts = 0;

    // helper to (re)create the socket and wire handlers
    const createSocket = async (): Promise<any> => {
      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger as any),
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
          if (qr && !resolved) {
            try {
              this.logger.log(`Received QR for session ${sessionId}: [length=${String(qr).length}]`);
              await fsp.mkdir(sessionDir, { recursive: true });
              await fsp.writeFile(path.join(sessionDir, 'qr.txt'), String(qr), 'utf8');
              await QRCode.toFile(path.join(sessionDir, 'qr.png'), qr, { type: 'png' });
            } catch (saveErr) {
              this.logger.warn('Failed to save QR files', saveErr as any);
            }

            const dataUrl = await QRCode.toDataURL(qr, { type: 'image/png' });
            resolved = true;
            return { type: 'qr', dataUrl };
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

            if (!resolved) {
              resolved = true;
              return { type: 'connected', fileContents };
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

      return sock;
    };

    // Single attempt with a 60s timeout for QR generation
    return new Promise<BaileysSession>(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!resolved) {
          this.logger.warn(`QR generation timeout for session ${sessionId}`);
          resolved = true;
          reject(new Error('QR generation timeout'));
        }
  }, 120_000); // 120s to allow QR generation

      // create initial socket
      try {
        const initialSock = await createSocket();
        // listen for the first QR or connected event by polling socket updates
        // since createSocket returns immediately and handlers return values, we
        // rely on those handlers to set `resolved` and write files. For the
        // Promise resolution, watch the filesystem for created creds or qr.png

        const watcher = setInterval(async () => {
          if (resolved) {
            clearInterval(watcher);
            clearTimeout(timeout);
            // check creds file to decide connected state
            const credsPath = path.join(sessionDir, 'creds.json');
            try {
              const fileContents = await fsp.readFile(credsPath, 'utf8');
              resolve({ sessionId, userId, phoneNumber, qr: undefined, connected: true, sessionFile: sessionDir, sessionData: fileContents });
              return;
            } catch (e) {
              // if creds not present but qr.png is present, return qr
              try {
                const pngPath = path.join(sessionDir, 'qr.png');
                if (fs.existsSync(pngPath)) {
                  const image = await fsp.readFile(pngPath);
                  const dataUrl = `data:image/png;base64,${image.toString('base64')}`;
                  resolve({ sessionId, userId, phoneNumber, qr: dataUrl, connected: false, sessionFile: sessionDir, sessionData: null });
                  return;
                }
              } catch (e) {}
            }
          }
        }, 500);
      } catch (err) {
        clearTimeout(timeout);
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
}
