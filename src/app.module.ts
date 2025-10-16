import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { ClientsModule } from './clients/clients.module';

const TypeOrmImport = [
  TypeOrmModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (configService: ConfigService) => ({
      type: 'postgres',
      host: configService.get<string>('DB_HOST', 'localhost'),
      port: parseInt(configService.get<string>('DB_PORT', '5432'), 10),
      username: configService.get<string>('DB_USER', 'postgres'),
      password: configService.get<any>('DB_PASS', ''),
      database: configService.get<string>('DB_NAME', 'postgres'),
      synchronize: configService.get<string>('DB_SYNC', 'false') === 'true',
      autoLoadEntities: true,
      logging: configService.get<string>('DB_LOGGING', 'false') === 'true',
    }),
  }),
];

@Module({
  imports: [
    // carregar .env.local se existir (dev) e fallback para .env
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    ...TypeOrmImport,
    ClientsModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
