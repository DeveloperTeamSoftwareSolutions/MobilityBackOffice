import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { AuthService, LoginResult } from './auth.service';
import { JwtGuard } from './jwt.guard';
import { LoginDto } from './dto/login.dto';
import type { BackOfficeJwtPayload } from './token.service';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /api/auth/login
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<{ success: true } & LoginResult> {
    const result = await this.authService.login({
      email: dto.email,
      password: dto.password,
    });
    return { success: true, ...result };
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
