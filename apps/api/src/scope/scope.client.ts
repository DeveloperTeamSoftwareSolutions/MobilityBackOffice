import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { middlewareBase, middlewareHeaders } from '../common/middleware-request';

/** Endpoint del middleware dueño de la jerarquía (`fn_SubordinatesByUser` + `Users`). */
const PATH = '/mobility/user-scope';

/**
 * Scope resuelto de un usuario, tal como lo publica el middleware.
 *
 * ⚠️ `userGuids` y `companyCodes` NO son el mismo conjunto y no hay que derivar uno del
 * otro: el primero es el subárbol de usuarios; el segundo, las sociedades de ese subárbol.
 * Para un admin, `companyCodes` viene **vacío a propósito** — significa "no filtrar", no
 * "no ve nada". Por eso los dos campos viajan juntos y el consumidor mira los dos.
 */
export interface UserScope {
  isAdmin: boolean;
  userGuids: string[];
  companyCodes: string[];
}

/**
 * Cliente del scope por jerarquía en MobilityMiddleWare.
 *
 * El alcance **no se calcula en BackOffice**: la política (subárbol / bypass de admin /
 * auto-inclusión) vive del lado del middleware, que es el único que conecta a SQL Server.
 * Acá sólo se consume. Portado de MobilityManager, que resuelve el mismo alcance con este
 * mismo endpoint — la identidad coincide, porque el JWT de BackOffice lleva
 * `guidUsers = Users.Guid`.
 */
@Injectable()
export class ScopeClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async getUserScope(guidUsers: string, includeSelf: boolean): Promise<UserScope> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data?: UserScope }>(
          `${middlewareBase(this.config)}${PATH}`,
          {
            params: { guidUsers, includeSelf: includeSelf ? 1 : 0 },
            headers: middlewareHeaders(this.config),
            timeout: 20000,
          },
        ),
      );
      const data = res.data?.data;
      if (!data) throw new Error('respuesta sin data');
      return {
        isAdmin: !!data.isAdmin,
        userGuids: data.userGuids ?? [],
        companyCodes: data.companyCodes ?? [],
      };
    } catch {
      // Se propaga como 503 y NO como "scope vacío": un alcance vacío se vería igual que
      // "no tenés sociedades" y dejaría al usuario mirando una pantalla en blanco sin
      // saber que el problema es de infraestructura.
      throw new ServiceUnavailableException('El servicio de jerarquía no está disponible');
    }
  }
}
