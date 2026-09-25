import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '../auth/auth.module';
import { ConsistencyController } from './consistency.controller';
import { ConsistencyService } from './consistency.service';
import { ConsistencyClient } from './consistency.client';

/**
 * Consistencia de datos: detecta inconsistencias entre jerarquía comercial, carteras,
 * usuarios y SAP, y corrige las que son de datos comerciales. AuditService llega por el
 * AuditModule global. Ver docs/SPEC_CONSISTENCIA_DE_DATOS.md.
 */
@Module({
  imports: [AuthModule, HttpModule],
  controllers: [ConsistencyController],
  providers: [ConsistencyService, ConsistencyClient],
})
export class ConsistencyModule {}
