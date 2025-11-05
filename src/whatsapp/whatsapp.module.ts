import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappConnection } from './whatsapp.entity';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { BaileysManager } from './baileys.manager';
import { ClientsModule } from '../clients/clients.module';

@Module({
  imports: [TypeOrmModule.forFeature([WhatsappConnection]), ClientsModule],
  providers: [WhatsappService, BaileysManager],
  controllers: [WhatsappController],
  exports: [WhatsappService],
})
export class WhatsappModule {}
