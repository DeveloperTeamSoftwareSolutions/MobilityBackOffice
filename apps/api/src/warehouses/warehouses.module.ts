import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '../auth/auth.module';
import { ScopeModule } from '../scope/scope.module';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';
import { WarehousesClient } from './warehouses.client';

/**
 * Módulo de Centros y Almacenes.
 *
 * Importa `AuthModule` (JwtGuard + RolesGuard), `HttpModule` (cliente al middleware, dueño
 * del CRUD sobre `[SAPServices]`) y `ScopeModule` — **la única sección de BackOffice que lo
 * importa**, porque es la única que recorta por sociedad. `AuditService` llega de su módulo
 * global.
 */
@Module({
  imports: [AuthModule, HttpModule, ScopeModule],
  controllers: [WarehousesController],
  providers: [WarehousesService, WarehousesClient],
})
export class WarehousesModule {}
