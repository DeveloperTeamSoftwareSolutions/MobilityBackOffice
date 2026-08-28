import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthService, LoginResult } from './auth.service';
import { JwtGuard } from './jwt.guard';
import { LoginDto } from './dto/login.dto';
import type { BackOfficeJwtPayload } from './token.service';
import { RAG_COOKIE, RAG_PREFIX } from '../rag/rag.proxy';
import { WABA_COOKIE, WABA_PREFIX } from '../waba/waba.proxy';

/**
 * Milisegundos que faltan para que expire el token (leyendo el claim `exp`, en
 * segundos). Si no se puede leer, cae a una hora. Se usa para el maxAge de la cookie
 * de sesion del iframe RAG, de modo que caduque junto con el token.
 */
function tokenMaxAgeMs(token: string): number {
  const oneHour = 60 * 60 * 1000;
  const parts = token.split('.');
  if (parts.length !== 3) return oneHour;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(
      Buffer.from(b64, 'base64').toString('utf8'),
    ) as { exp?: number };
    if (typeof claims.exp !== 'number') return oneHour;
    return Math.max(0, claims.exp * 1000 - Date.now());
  } catch {
    return oneHour;
  }
}

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  // POST /api/auth/login
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true } & LoginResult> {
    const result = await this.authService.login({
      email: dto.email,
      password: dto.password,
    });

    // Cookie httpOnly scopeada a /rag: es la unica forma de que el iframe del RAG
    // (que no puede mandar Authorization) lleve la sesion. Caduca con el token.
    res.cookie(RAG_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<string>('nodeEnv') === 'production',
      path: RAG_PREFIX,
      maxAge: tokenMaxAgeMs(result.token),
    });

    // Misma cookie, otro prefijo: el iframe del panel WABA tampoco puede mandar
    // Authorization en sus sub-requests.
    res.cookie(WABA_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<string>('nodeEnv') === 'production',
      path: WABA_PREFIX,
      maxAge: tokenMaxAgeMs(result.token),
    });

    return { success: true, ...result };
  }

  // POST /api/auth/logout — limpia las cookies de sesion de los embebidos.
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response): { success: true } {
    res.clearCookie(RAG_COOKIE, { path: RAG_PREFIX });
    res.clearCookie(WABA_COOKIE, { path: WABA_PREFIX });
    return { success: true };
  }

  // GET /api/auth/me — devuelve los claims del token propio (incluye el rol).
  @Get('me')
  @UseGuards(JwtGuard)
  me(@Req() req: { user?: BackOfficeJwtPayload }): {
    success: true;
    user: BackOfficeJwtPayload | undefined;
  } {
    return { success: true, user: req.user };
  }
}
