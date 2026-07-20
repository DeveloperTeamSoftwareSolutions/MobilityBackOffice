import { Injectable } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BackOfficeRole } from './backoffice-role.enum';

/**
 * Claims del JWT que emite MobilityBackOffice.
 *
 * Se mantienen los nombres del token de ManageIT (`sub`, `guid`, `email`,
 * `username`, `isAdmin`) para que el código que lee la identidad sea portable
 * entre apps del ecosistema, y se agrega `role`: el rol de ESTA app, resuelto en
 * el login contra el accessMatrix. Ese claim es la autoridad de autorización.
 */
export interface BackOfficeJwtPayload {
  sub: string;
  guid: string;
  guidApiLoginClients?: string | null;
  email: string;
  username: string;
  /** Flag global de ManageIT. Informativo: NO autoriza por sí solo. */
  isAdmin: boolean;
  role: BackOfficeRole;
}

/**
 * Emisión y verificación del token propio de BackOffice.
 *
 * Por qué token propio y no el de ManageIT: el JWT de ManageIT no incluye los
 * roleKeys (viajan solo en el body del login), así que un guard que lo verifique
 * solo puede autorizar por `isAdmin`, que es global y cruza aplicaciones. Firmar
 * el nuestro con el rol adentro es el mismo camino que ya tomó MobilityIA.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async sign(payload: BackOfficeJwtPayload): Promise<string> {
    // `expiresIn` acepta un literal tipo '1h' o segundos; el tipo de la librería
    // es más estrecho que `string`, de ahí el cast del valor de configuración.
    const expiresIn = (this.config.get<string>('jwt.expiresIn') ??
      '1h') as JwtSignOptions['expiresIn'];

    return this.jwt.signAsync(payload, {
      secret: this.config.get<string>('jwt.secret'),
      expiresIn,
    });
  }

  async verify(token: string): Promise<BackOfficeJwtPayload> {
    return this.jwt.verifyAsync<BackOfficeJwtPayload>(token, {
      secret: this.config.get<string>('jwt.secret'),
    });
  }
}
