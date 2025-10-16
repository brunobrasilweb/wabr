import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from './client.entity';
import { ClientsService } from './clients.service';
import { ClientsSeeder } from './clients.seeder';
import { TokenAuthGuard } from '../auth/token-auth.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Client])],
  providers: [ClientsService, ClientsSeeder, TokenAuthGuard],
  exports: [ClientsService, TokenAuthGuard],
})
export class ClientsModule {}
