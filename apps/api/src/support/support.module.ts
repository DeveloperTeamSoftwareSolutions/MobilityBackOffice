import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '../auth/auth.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { SupportClient } from './support.client';

/**
 * Consola de soporte (fase 1: auditoria en solo lectura).
 *
 * Importa AuthModule (JwtGuard + RolesGuard) y HttpModule (SupportClient). No usa
 * AuditService todavia: la fase 1 no escribe. Ver docs/SPEC_CONSOLA_SOPORTE.md.
 */
@Module({
  imports: [AuthModule, HttpModule],
  controllers: [SupportController],
  providers: [SupportService, SupportClient],
})
export class SupportModule {}
