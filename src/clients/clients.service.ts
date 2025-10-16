import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from './client.entity';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly repo: Repository<Client>,
  ) {}

  async findByToken(token: string): Promise<Client | null> {
    if (!token) return null;
    return this.repo.findOne({ where: { token } });
  }

  async create(client: Partial<Client>): Promise<Client> {
    const ent = this.repo.create(client as any);
    return this.repo.save(ent as any);
  }

  // minimal helper for seeding/testing
  async ensureSeed(client: Partial<Client>): Promise<Client> {
    const existing = await this.repo.findOne({ where: { token: client.token } });
    if (existing) return existing;
    return this.create(client);
  }
}
