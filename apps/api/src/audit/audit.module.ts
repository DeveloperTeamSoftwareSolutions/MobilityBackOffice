import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Módulo global de auditoría. Expone `AuditService` a toda la app sin re-importarlo
 * en cada módulo. PrismaService llega del PrismaModule global.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
