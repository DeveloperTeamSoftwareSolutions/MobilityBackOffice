import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RegionsController } from './regions.controller';
import { RegionsSyncController } from './regions-sync.controller';
import { RegionsService } from './regions.service';
import { RegionsRepository } from './regions.repository';
import { ApiKeyGuard } from './api-key.guard';

/**
 * Módulo de Regiones comerciales por CEBE. Importa AuthModule (JwtGuard + RolesGuard).
 * El módulo exige rol Administrador; el sync máquina-a-máquina va por ApiKeyGuard.
 * AuditService y PrismaService llegan de sus módulos globales.
 */
@Module({
  imports: [AuthModule],
  controllers: [RegionsController, RegionsSyncController],
  providers: [RegionsService, RegionsRepository, ApiKeyGuard],
})
export class RegionsModule {}
