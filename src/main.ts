import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('WABR API')
    .setDescription('API documentation')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
  await app.listen(port);
  console.log(`Server listening on http://localhost:${port}`);
  console.log(`Swagger available at http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap application', err);
  process.exit(1);
});
