import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientsService } from './clients.service';

@Injectable()
export class ClientsSeeder implements OnModuleInit {
  private readonly logger = new Logger(ClientsSeeder.name);

  constructor(private readonly clientsService: ClientsService) {}

  async onModuleInit() {
    try {
      // create a default client for local development if not exists
      const token = process.env.DEV_CLIENT_TOKEN || 'dev-token-please-change';
      const name = process.env.DEV_CLIENT_NAME || 'local-dev-client';

      const client = await this.clientsService.ensureSeed({ token, name, status: 'active' });
      this.logger.log(`Seeded client id=${client.id} name=${client.name}`);
    } catch (err) {
      this.logger.debug('Seeder skipped or failed: ' + String(err));
    }
  }
}
