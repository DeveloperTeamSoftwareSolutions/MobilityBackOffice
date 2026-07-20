import {
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/** Usuario autenticado tal como lo devuelve ITManager (guid = Users.Guid). */
export interface ItmanagerUser {
  guid: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

/** Resultado normalizado del login contra ITManager (ManageIT). */
export interface ItmanagerLoginResult {
  token: string;
  user: ItmanagerUser;
  roleKeys: string[];
  permissions: string[];
}

/** Forma (parcial) del response de ManageIT POST /api/auth/login. */
interface ManageItAccessMatrixEntry {
  appId: string;
  roles?: { roleKey: string }[];
  permissions?: string[];
}
interface ManageItLoginResponse {
  user: { guid: string; email: string; name: string; isAdmin: boolean };
  session: { token: string };
  accessMatrix?: ManageItAccessMatrixEntry[];
}

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

/**
 * Cliente HTTP hacia ITManager. Autentica y normaliza el response: extrae los
 * roleKeys/permissions del accessMatrix correspondiente a APP_ID y traduce los
 * errores HTTP a excepciones de Nest.
 *
 * BackOffice no emite JWT propio: reusa el `session.token` de ManageIT.
 */
@Injectable()
export class ItmanagerClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<ItmanagerLoginResult> {
    const authUrl = this.config.get<string>('itmanager.authUrl');
    const appId =
      this.config.get<string>('itmanager.appId') ?? 'MobilityBackOffice';
    const permPrefix = this.config.get<string>('itmanager.permPrefix') ?? '';

    let data: ManageItLoginResponse;
    try {
      const res = await firstValueFrom(
        this.http.post<ManageItLoginResponse>(`${authUrl}/auth/login`, {
          username: email,
          password,
          appId,
        }),
      );
      data = res.data;
    } catch (err) {
      if (httpStatus(err) === 401) {
        throw new UnauthorizedException('Credenciales inválidas');
      }
      throw new ServiceUnavailableException('ITManager no está disponible');
    }

    // El accessMatrix trae una entrada por app: nos quedamos con la nuestra.
    const appEntry = data.accessMatrix?.find((a) => a.appId === appId);
    const roleKeys = appEntry?.roles?.map((r) => r.roleKey) ?? [];
    const permissions = (appEntry?.permissions ?? []).map((p) =>
      p.startsWith(permPrefix) ? p.slice(permPrefix.length) : p,
    );

    return {
      token: data.session.token,
      user: {
        guid: data.user.guid,
        email: data.user.email,
        name: data.user.name,
        isAdmin: data.user.isAdmin,
      },
      roleKeys,
      permissions,
    };
  }
}
