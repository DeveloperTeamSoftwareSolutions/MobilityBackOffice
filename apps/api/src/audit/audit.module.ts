import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuditService } from './audit.service';
import { AuditClient } from './audit.client';

/**
 * Módulo global de auditoría. Expone `AuditService` a toda la app (el login lo usa) sin
 * re-importarlo en cada módulo.
 *
 * Escribe por HTTP contra el middleware, dueño de `AuditLogs`. Ya no depende de
 * PrismaService: era el último uso del ORM en BackOffice.
 */
@Global()
@Module({
  imports: [HttpModule],
  providers: [AuditService, AuditClient],
  exports: [AuditService],
})
export class AuditModule {}
