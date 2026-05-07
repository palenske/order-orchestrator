import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { RecoveryService } from './modules/queue/services/recovery.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  const recoveryService = app.get(RecoveryService);
  await recoveryService.recoverStuckOrders();

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
