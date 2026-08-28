import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '../auth/auth.module';
import { RegionsModule } from '../regions/regions.module';
import { AuthorizersController } from './authorizers.controller';
import { AuthorizersService } from './authorizers.service';
import { AuthorizersClient } from './authorizers.client';

/**
 * Matriz de autorizadores (solo lectura).
 *
 * Importa `RegionsModule` por una sola razon: el maestro de sociedades. Regiones ya lo
 * resuelve contra `/v2/mobility/companies` y no tiene sentido tener dos clientes del
 * mismo catalogo. `RegionsModule` exporta `RegionsClient` para esto.
 */
@Module({
  imports: [AuthModule, HttpModule, RegionsModule],
  controllers: [AuthorizersController],
  providers: [AuthorizersService, AuthorizersClient],
})
export class AuthorizersModule {}
