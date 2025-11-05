import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WhatsappConnection } from './whatsapp.entity';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { BaileysManager } from './baileys.manager';
import { ClientsModule } from '../clients/clients.module';
import { WhatsappWebhook } from './webhook.entity';
import { WhatsappWebhookEvent } from './webhook-event.entity';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { WebhookProcessor } from './webhook.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([WhatsappConnection, WhatsappWebhook, WhatsappWebhookEvent]),
    ClientsModule,
    BullModule.registerQueueAsync(
      {
        name: 'webhooks',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          redis: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: parseInt(configService.get<string>('REDIS_PORT', '6379'), 10),
            password: configService.get<string>('REDIS_PASSWORD'),
            db: parseInt(configService.get<string>('REDIS_DB', '0'), 10),
          },
        }),
      },
    ),
  ],
  providers: [WhatsappService, BaileysManager, WebhookService, WebhookProcessor],
  controllers: [WhatsappController, WebhookController],
  exports: [WhatsappService, WebhookService],
})
export class WhatsappModule {}
