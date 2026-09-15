import { Injectable, ForbiddenException } from '@nestjs/common';
import { ItmanagerClient, ItmanagerLoginResult } from './itmanager.client';
import { RoleResolver } from './role-resolver.service';
import { TokenService } from './token.service';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '../audit/audit.categories';
import { BackOfficeRole } from './backoffice-role.enum';

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  token: string;
  user: { email: string; name: string; guidUsers: string };
  role: BackOfficeRole;
  permissions: string[];
}

type AuditAction = 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT';

interface AuthAuditEntry {
  email: string;
  guidUsers?: string;
  /** Solo se conoce despues de que ITManager valido las credenciales. */
  guidApiLoginClients?: string | null;
  role?: BackOfficeRole;
  action: AuditAction;
  detail?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Orquestador del login.
 *
 * ITManager es la única autoridad de credenciales y de roles asignados; acá no se
 * reimplementa nada de eso. Lo que sí hace BackOffice es EMITIR SU PROPIO TOKEN con
 * el rol de la app adentro, porque el JWT de ManageIT no incluye los roleKeys y sin
 * ellos la autorización en runtime se degrada a `isAdmin`, que es global y cruza
 * aplicaciones. Mismo enfoque que MobilityIA.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly itmanager: ItmanagerClient,
    private readonly roleResolver: RoleResolver,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const { email, password } = input;

    // 1. Credenciales: ITManager.
    let itm: ItmanagerLoginResult;
    try {
      itm = await this.itmanager.login(email, password);
    } catch (err) {
      await this.auditAuth({
        email,
        action: 'LOGIN_FAILED',
        detail: errorMessage(err),
      });
      throw err;
    }

    const guidUsers = itm.user.guid; // = Users.Guid

    // 2. Rol = rol asignado en ITManager para ESTA app.
    const role = this.roleResolver.resolve({
      roleKeys: itm.roleKeys,
      isAdmin: itm.user.isAdmin,
    });

    if (!role) {
      await this.auditAuth({
        email,
        guidUsers,
        guidApiLoginClients: itm.guidApiLoginClients,
        action: 'LOGIN_FAILED',
        detail: 'sin rol asignado en MobilityBackOffice',
      });
      throw new ForbiddenException(
        'El usuario no tiene un rol asignado en MobilityBackOffice',
      );
    }

    // 3. Token propio, con el rol como claim de autoridad.
    const token = await this.tokens.sign({
      sub: guidUsers,
      guid: guidUsers,
      // Viaja en el token para que cualquier accion posterior pueda auditarse contra el
      // cliente correcto sin volver a preguntarle a ITManager.
      guidApiLoginClients: itm.guidApiLoginClients,
      email: itm.user.email,
      username: itm.user.name,
      isAdmin: itm.user.isAdmin,
      role,
    });

    // 4. Auditoría del acceso exitoso.
    await this.auditAuth({
      email,
      guidUsers,
      guidApiLoginClients: itm.guidApiLoginClients,
      role,
      action: 'LOGIN',
    });

    return {
      token,
      user: { email: itm.user.email, name: itm.user.name, guidUsers },
      role,
      permissions: itm.permissions,
    };
  }

  private async auditAuth(entry: AuthAuditEntry): Promise<void> {
    // El resultado se distingue por `Action` (LOGIN vs LOGIN_FAILED): `AuditLogs` no
    // tiene columna de éxito. La identidad sí tiene la suya (`ActorEmail`), así que el
    // email va ahí y `Detail` queda para lo que no entra en ninguna columna.
    const detailParts: string[] = [];
    if (entry.role) detailParts.push(`rol=${entry.role}`);
    if (entry.detail) detailParts.push(entry.detail);

    await this.audit.record({
      guidUsers: entry.guidUsers ?? null,
      // Sin esto la fila existe pero no se ve: la auditoría de ITManager filtra por cliente.
      guidApiLoginClients: entry.guidApiLoginClients ?? null,
      actorEmail: entry.email,
      action: entry.action,
      entity: 'Auth',
      category: AuditCategory.Auth,
      detail: detailParts.join(' | ') || null,
    });
  }
}
