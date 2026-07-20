import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from './token.service';

interface AuthRequest {
  headers?: { authorization?: string };
  cookies?: { token?: string };
  user?: unknown;
}

/**
 * Verifica el JWT propio de BackOffice (HS256, secret propio) y popula `req.user`
 * con sus claims, incluido `role`. Sin llamada de red.
 *
 * Un token de ManageIT o de otra app del ecosistema NO valida acá: están firmados
 * con otro secret. Eso es deliberado.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Token de autenticación ausente');
    }

    try {
      req.user = await this.tokens.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  private extractToken(req: AuthRequest): string | undefined {
    const auth = req.headers?.authorization;
    if (auth?.startsWith('Bearer ')) {
      return auth.slice('Bearer '.length);
    }
    return req.cookies?.token;
  }
}
