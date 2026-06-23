import './tracing';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { RecoveryService } from './modules/queue/services/recovery.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  const recoveryService = app.get(RecoveryService);
  await recoveryService.recoverStuckOrders();

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
