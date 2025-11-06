import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Message } from './message.entity';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { MessagesProcessor } from './messages.processor';
import { BaileysManager } from '../whatsapp/baileys.manager';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ClientsModule } from '../clients/clients.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message]),
    BullModule.registerQueueAsync(
      {
        name: 'messages',
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
    WhatsappModule,
    ClientsModule,
  ],
  providers: [MessagesService, MessagesProcessor, BaileysManager],
  controllers: [MessagesController],
  exports: [MessagesService],
})
export class MessagesModule {}
