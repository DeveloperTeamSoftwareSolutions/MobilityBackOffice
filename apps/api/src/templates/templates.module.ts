import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '../auth/auth.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { TemplatesClient } from './templates.client';

/**
 * Plantillas de WhatsApp (solo lectura).
 *
 * Consume la API REST del panel WABA con `x-api-key`. No importa `RegionsModule` ni toca
 * el middleware: las plantillas viven en `WhatsAppWABA` y el middleware no las expone.
 */
@Module({
  imports: [AuthModule, HttpModule],
  controllers: [TemplatesController],
  providers: [TemplatesService, TemplatesClient],
})
export class TemplatesModule {}
