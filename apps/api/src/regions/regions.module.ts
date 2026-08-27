import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '../auth/auth.module';
import { RegionsController } from './regions.controller';
import { RegionsSyncController } from './regions-sync.controller';
import { RegionsService } from './regions.service';
import { RegionsRepository } from './regions.repository';
import { RegionsClient } from './regions.client';
import { ApiKeyGuard } from './api-key.guard';

/**
 * Módulo de Regiones comerciales por CEBE. Importa AuthModule (JwtGuard + RolesGuard) y
 * HttpModule (RegionsClient). El módulo exige rol Administrador; el sync máquina-a-máquina
 * va por ApiKeyGuard. AuditService llega de su módulo global.
 *
 * Ya NO usa PrismaService: las tres fuentes del módulo —regiones, maestro de CEBEs y
 * maestro de sociedades— van por el middleware.
 */
@Module({
  imports: [AuthModule, HttpModule],
  controllers: [RegionsController, RegionsSyncController],
  providers: [RegionsService, RegionsRepository, RegionsClient, ApiKeyGuard],
  // `AuthorizersModule` reusa el maestro de sociedades (`searchCompanies`) en vez de
  // tener un segundo cliente del mismo catalogo.
  exports: [RegionsClient],
})
export class RegionsModule {}
