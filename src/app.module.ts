import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';

// Só inclui o TypeOrmModule se existir pelo menos DB_HOST ou DB_NAME configurado.
const shouldInitDb = !!(process.env.DB_HOST || process.env.DB_NAME || process.env.DATABASE_URL);

const TypeOrmImport = shouldInitDb
  ? [
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
    ]
  : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ...TypeOrmImport,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
