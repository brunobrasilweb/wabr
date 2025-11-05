import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsappConnection, WhatsappSessionStatus } from './whatsapp.entity';
import { BaileysManager } from './baileys.manager';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    @InjectRepository(WhatsappConnection)
    private readonly repo: Repository<WhatsappConnection>,
    private readonly baileys: BaileysManager,
  ) {}

  async createConnection(userId: string, phoneNumber: string): Promise<{ connection: WhatsappConnection; qr?: string }> {
    // enforce one active session per user
    const existing = await this.repo.findOne({ where: { userId } });
    if (existing && existing.sessionStatus === 'connected') {
      const err: any = new Error('Sessão já existente');
      err.code = 'SESSION_EXISTS';
      throw err;
    }

    const baileysSession = await this.baileys.createSession(userId, phoneNumber);

    const conn = this.repo.create({
      userId,
      phoneNumber,
      sessionStatus: baileysSession.connected ? 'connected' : 'reconnecting',
      sessionData: baileysSession.sessionData ? { raw: baileysSession.sessionData } : { sessionId: baileysSession.sessionId },
    } as any);

    const saved = await this.repo.save(conn as any);

    return { connection: saved, qr: baileysSession.qr };
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
}
