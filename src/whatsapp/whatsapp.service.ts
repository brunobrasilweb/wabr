import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsappConnection, WhatsappSessionStatus } from './whatsapp.entity';
import { BaileysManager } from './baileys.manager';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    @InjectRepository(WhatsappConnection)
    private readonly repo: Repository<WhatsappConnection>,
    private readonly baileys: BaileysManager,
  ) {}

  // subscribe to BaileysManager lifecycle events to keep DB in sync
  onModuleInit() {
    try {
      this.logger.log('Attaching BaileysManager.connected listener');
      this.baileys.events.on('connected', async (payload: any) => {
        this.logger.log('baileys.connected event received: ' + JSON.stringify(payload));
        try {
          const { userId, sessionId, fileContents, phoneNumber } = payload || {};
          if (!userId) {
            this.logger.warn('connected event missing userId, ignoring');
            return;
          }
          
          // Find by userId (primary key for user sessions)
          let existing = await this.repo.findOne({ where: { userId } });
          
          if (!existing) {
            this.logger.warn(`No DB entry found for userId=${userId} on connected event, creating new one`);
            // Create if doesn't exist (shouldn't happen, but be defensive)
            const newConn = this.repo.create({
              userId,
              phoneNumber: phoneNumber || '',
              sessionStatus: 'connected',
              sessionData: fileContents ? { raw: fileContents } : ({ sessionId } as any),
            } as any);
            await this.repo.save(newConn as any);
            this.logger.log(`Created and updated DB session for user ${userId} -> connected (sessionId=${sessionId})`);
          } else {
            existing.sessionStatus = 'connected';
            existing.sessionData = fileContents ? { raw: fileContents } : ({ sessionId } as any);
            existing.phoneNumber = phoneNumber || existing.phoneNumber;
            await this.repo.save(existing as any);
            this.logger.log(`Updated DB session for user ${userId} -> connected (sessionId=${sessionId})`);
          }
        } catch (e) {
          this.logger.error('Error updating DB on connected event', e as any);
        }
      });

      this.logger.log('Attaching BaileysManager.disconnected listener');
      this.baileys.events.on('disconnected', async (payload: any) => {
        this.logger.log('baileys.disconnected event received: ' + JSON.stringify(payload));
        try {
          const { userId, sessionId, statusCode, phoneNumber } = payload || {};
          if (!userId) {
            this.logger.warn('disconnected event missing userId, ignoring');
            return;
          }
          
          const existing = await this.repo.findOne({ where: { userId } });
          if (!existing) {
            this.logger.warn(`No DB entry found for userId=${userId} on disconnected event`);
            return;
          }
          
          existing.sessionStatus = 'disconnected';
          existing.sessionData = null as any;
          await this.repo.save(existing as any);
          this.logger.log(`Updated DB session for user ${userId} -> disconnected (sessionId=${sessionId}, statusCode=${statusCode})`);
        } catch (e) {
          this.logger.error('Error updating DB on disconnected event', e as any);
        }
      });
    } catch (e) {
      this.logger.warn('Failed to attach baileys event listeners', e as any);
    }
  }

  async createConnection(userId: string, phoneNumber: string): Promise<{ connection: WhatsappConnection; qr?: string }> {
    // enforce one active session per user
    const existing = await this.repo.findOne({ where: { userId } });
    if (existing && existing.sessionStatus === 'connected') {
      const err: any = new Error('Sessão já existente');
      err.code = 'SESSION_EXISTS';
      throw err;
    }

    // Create DB record BEFORE starting Baileys session so that event listeners can find it
    const conn = this.repo.create({
      userId,
      phoneNumber,
      sessionStatus: 'reconnecting',
      sessionData: null,
    } as any);

    const savedConn = await this.repo.save(conn as any);
    this.logger.log(`Created DB session record for userId=${userId} before starting Baileys`);

    try {
      const baileysSession = await this.baileys.createSession(userId, phoneNumber);
      
      // Update with initial session data
      savedConn.sessionStatus = baileysSession.connected ? 'connected' : 'reconnecting';
      savedConn.sessionData = baileysSession.sessionData ? { raw: baileysSession.sessionData } : { sessionId: baileysSession.sessionId } as any;
      
      const updated = await this.repo.save(savedConn as any);
      return { connection: updated, qr: baileysSession.qr };
    } catch (err) {
      // If Baileys fails, mark as disconnected
      savedConn.sessionStatus = 'disconnected';
      await this.repo.save(savedConn as any);
      throw err;
    }
  }

  async disconnect(userId: string): Promise<WhatsappConnection> {
    const existing = await this.repo.findOne({ where: { userId } });
    if (!existing) {
      const err: any = new Error('Not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    const sessionId = existing.sessionData?.sessionId as string | undefined;
    if (sessionId) {
      await this.baileys.disconnect(sessionId);
    }

    existing.sessionStatus = 'disconnected';
    existing.sessionData = null;
    return this.repo.save(existing as any);
  }

  async status(userId: string): Promise<{ status: WhatsappSessionStatus; lastUpdate: Date }> {
    const existing = await this.repo.findOne({ where: { userId } });
    if (!existing) {
      const err: any = new Error('Not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return { status: existing.sessionStatus as WhatsappSessionStatus, lastUpdate: existing.updatedAt };
  }

  async sendText(userId: string, to: string, text: string): Promise<{ ok: boolean; id?: string; error?: string }> {
    const existing = await this.repo.findOne({ where: { userId } });
    if (!existing) {
      return { ok: false, error: 'NOT_FOUND' };
    }

    if (existing.sessionStatus !== 'connected') {
      return { ok: false, error: 'NOT_CONNECTED' };
    }

    try {
      const res = await this.baileys.sendMessage(userId, to, text);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, id: res.id };
    } catch (err: any) {
      this.logger.error('sendText error', err?.stack ?? err);
      return { ok: false, error: String(err?.message ?? err) };
    }
  }
}
