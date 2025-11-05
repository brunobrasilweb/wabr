import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsappConnection, WhatsappSessionStatus } from './whatsapp.entity';
import { BaileysManager } from './baileys.manager';
import { WebhookService } from './webhook.service';
import { ClientsService } from '../clients/clients.service';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    @InjectRepository(WhatsappConnection)
    private readonly repo: Repository<WhatsappConnection>,
    private readonly baileys: BaileysManager,
    private readonly webhookService: WebhookService,
    private readonly clientsService: ClientsService,
  ) {}

  // subscribe to BaileysManager lifecycle events to keep DB in sync
  async onModuleInit() {
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

      this.logger.log('Attaching BaileysManager.message listener for webhook processing');
      this.baileys.events.on('message', async (payload: any) => {
        try {
          const { sessionId, userId, phoneNumber, message } = payload || {};
          if (!userId || !message) {
            this.logger.warn('message event missing userId or message, ignoring');
            return;
          }

          this.logger.log(
            `Received message event: userId=${userId}, messageId=${message.messageId}, from=${message.from}`,
          );

          // TODO: In a real implementation, find the clientId from a mapping of userId -> clientId
          // For now, we'll need to extend this logic based on your data model
          // This assumes you have a way to map userId to clientId

          // Find the client associated with this WhatsApp session
          // This depends on your data model - you may need to store clientId in WhatsappConnection
          // For this implementation, we'll demonstrate the webhook flow

          const connection = await this.repo.findOne({ where: { userId } });
          if (!connection) {
            this.logger.warn(`No connection found for userId=${userId}`);
            return;
          }

          // NOTE: In production, prefer storing clientId on WhatsappConnection.
          // Try to obtain clientId from the connection; if missing, fall back to
          // searching for any active webhook registered to this phone number.
          let clientId: number | undefined = (connection as any).clientId as number | undefined;

          if (!clientId) {
            try {
              const fallbackWebhook = await this.webhookService.findAnyActiveWebhookByPhone(connection.phoneNumber);
              if (fallbackWebhook) {
                clientId = fallbackWebhook.clientId;
                this.logger.log(
                  `Found fallback webhook for phone=${connection.phoneNumber} -> clientId=${clientId}. Using this to send webhook event.`,
                );
              } else {
                this.logger.debug(`No clientId mapping found for userId=${userId} and phone=${connection.phoneNumber}`);
              }
            } catch (e) {
              this.logger.warn('Error while attempting fallback webhook lookup', e as any);
            }
          }

          if (!clientId) {
            this.logger.debug(`Webhook processing skipped: no clientId for userId=${userId} phone=${connection.phoneNumber}`);
          } else {
            // Proceed to send webhook event
            try {
              await this.webhookService.sendWebhookEvent({
                clientId,
                phoneNumber: connection.phoneNumber,
                messageId: message.messageId,
                from: message.from,
                to: message.to,
                type: message.type,
                content: message.content,
              });
              this.logger.log(`Webhook event enqueued for messageId=${message.messageId} clientId=${clientId}`);
            } catch (err) {
              this.logger.warn(`Failed to send webhook event: ${(err as any)?.message}`);
            }
          }
        } catch (e) {
          this.logger.error('Error processing message event', e as any);
        }
      });
    } catch (e) {
      this.logger.warn('Failed to attach baileys event listeners', e as any);
    }

    // Attempt to restore any persisted Baileys sessions on startup so sockets
    // are available immediately without waiting for the first outbound send.
    try {
      this.logger.log('Attempting to restore persisted Baileys sessions');
      await this.baileys.restoreAllSessions();
    } catch (e) {
      this.logger.warn('Failed to restore persisted Baileys sessions on startup', e as any);
    }
  }

  async createConnection(clientId: number | null, userId: string, phoneNumber: string): Promise<{ connection: WhatsappConnection; qr?: string }> {
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
      clientId: clientId ?? null,
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
