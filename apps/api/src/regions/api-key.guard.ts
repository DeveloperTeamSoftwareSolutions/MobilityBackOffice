import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ApiKeyRequest {
  headers?: { 'x-api-key'?: string };
}

/**
 * Guard del web service de sync de Regiones: valida el header `x-api-key` contra
 * `regions.syncApiKey` (env `REGIONS_SYNC_API_KEY`). Si la key no está configurada,
 * el endpoint queda **deshabilitado** (403) — no se acepta tráfico sin una key
 * explícita. Key incorrecta → 401.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('regions.syncApiKey');
    if (!expected) {
      throw new ForbiddenException('El sync de regiones no está habilitado');
    }
    const req = context.switchToHttp().getRequest<ApiKeyRequest>();
    if (req.headers?.['x-api-key'] !== expected) {
      throw new UnauthorizedException('x-api-key inválida');
    }
    return true;
  }
}
