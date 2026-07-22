import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { APP_NAME, APP_VERSION } from './version';
import { TokenService } from './auth/token.service';
import {
  createRagProxy,
  createRagAuthGuard,
  RAG_PREFIX,
} from './rag/rag.proxy';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.get<string>('corsOrigin'),
    credentials: true,
  });

  // Reverse-proxy hacia DuwyEngineRAG (/rag/* same-origin para el iframe). Solo si
  // RAG_URL esta configurada. El guard exige sesion de BackOffice (cookie) + rol
  // Marketing/SuperAdmin antes de proxyar; el RAG no tiene auth propia. Se monta
  // ANTES del fallback SPA para que /rag no sea capturado por el.
  const ragUrl = config.get<string>('rag.url');
  if (ragUrl) {
    const tokens = app.get(TokenService);
    app.use(
      RAG_PREFIX,
      createRagAuthGuard((t) => tokens.verify(t)),
      createRagProxy(ragUrl),
    );
    Logger.log(`Reverse-proxy RAG montado en ${RAG_PREFIX} -> ${ragUrl}`, 'Bootstrap');
  }

  // Servir el frontend (build de Vite) para deploy detrás de un solo puerto/ALB:
  // el API sirve apps/web/dist en `/` y sigue atendiendo /api.
  // SOLO se activa si el build existe. En desarrollo no existe -> se usa el dev
  // server de Vite (:5173), que proxyea /api hacia acá.
  const webDist = join(__dirname, '..', '..', 'web', 'dist');
  if (existsSync(webDist)) {
    app.useStaticAssets(webDist);
    const indexHtml = join(webDist, 'index.html');
    // Fallback SPA: GET de navegación (no backend, no archivo) -> index.html.
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (
        req.method !== 'GET' ||
        req.path.startsWith('/api') ||
        req.path.startsWith(RAG_PREFIX) ||
        req.path.includes('.')
      ) {
        return next();
      }
      res.sendFile(indexHtml);
    });
    Logger.log(`Sirviendo frontend estatico desde ${webDist}`, 'Bootstrap');
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);

  Logger.log(
    `${APP_NAME} v${APP_VERSION} escuchando en http://localhost:${port}`,
    'Bootstrap',
  );
}

void bootstrap();
