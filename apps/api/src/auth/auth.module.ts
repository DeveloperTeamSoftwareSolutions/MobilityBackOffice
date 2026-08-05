import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ItmanagerClient } from './itmanager.client';
import { RoleResolver } from './role-resolver.service';
import { TokenService } from './token.service';
import { JwtGuard } from './jwt.guard';
import { RolesGuard } from './roles.guard';

/**
 * Autenticación: gateway hacia ITManager (credenciales + rol asignado) y emisión
 * del token propio de BackOffice. AuditService llega de su módulo global.
 */
@Module({
  imports: [HttpModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    ItmanagerClient,
    RoleResolver,
    TokenService,
    JwtGuard,
    RolesGuard,
  ],
  // Se exportan los guards y TokenService para que los módulos de negocio
  // (Regiones, Marketing) puedan protegerse sin re-declarar providers.
  exports: [AuthService, TokenService, JwtGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
