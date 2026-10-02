import { loadEnv } from '@field-sales/shared';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function validateEnv() {
  try {
    return loadEnv(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function bootstrap() {
  const env = validateEnv();

  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  console.log(`API listening on port ${port} (log level: ${env.LOG_LEVEL})`);
}

void bootstrap();
