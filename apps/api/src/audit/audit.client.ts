import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { middlewareBase, middlewareHeaders } from '../common/middleware-request';

/** Endpoint del middleware dueño de `AuditLogs` (tabla central, compartida). */
const PATH = '/audit-logs';

/** Cuerpo del POST, tal como lo valida el middleware (camelCase). */
export interface MwAuditLogBody {
  guidUsers?: string | null;
  /**
   * Cliente dueno de la fila (`ApiLoginClients.Guid`).
   *
   * La pantalla de auditoria de ITManager **filtra por este campo**: sin el, la fila se
   * guarda igual pero no aparece del otro lado. Es el motivo por el que la auditoria de
   * BackOffice existia y nadie la veia.
   */
  guidApiLoginClients?: string | null;
  /** Email del actor. Va en su columna (`ActorEmail`) para poder filtrar por persona. */
  actorEmail?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  detail?: string | null;
  category?: string | null;
  appId?: string | null;
}

/**
 * Cliente de `AuditLogs` en MobilityMiddleWare.
 *
 * Reemplaza el `prisma.auditLogs.create()` que BackOffice hacía contra SQL Server.
 * `AuditLogs` es una tabla CENTRAL y COMPARTIDA —la escriben ITManager y las demás apps—
 * y el middleware es su dueño: la regla del ecosistema es que sea el único que conecta a
 * la base (ver docs/EXTERNAL_APIS.md).
 *
 * ⚠️ El middleware NO pone timestamps desde el cliente: los escribe él
 * (`DATEDIFF_BIG(...)`). Por eso este cuerpo no manda `timeStamp`/`serverTimestamp` —
 * mandarlos habría hecho que la hora de la auditoría fuera la del reloj de BackOffice.
 */
@Injectable()
export class AuditClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private base(): string {
    return middlewareBase(this.config);
  }

  private headers(): Record<string, string> {
    return middlewareHeaders(this.config);
  }

  /**
   * Registra un evento. Propaga el error si el middleware no responde o rechaza: quien
   * necesite tolerancia usa `AuditService.safeRecord`, que decide esa política. El
   * transporte no es el lugar donde se decide si una auditoría puede perderse.
   */
  async create(body: MwAuditLogBody): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${this.base()}${PATH}`, body, {
          headers: this.headers(),
          // Corto a propósito: la auditoría acompaña a una operación del usuario y no
          // puede ser lo que la haga esperar.
          timeout: 10000,
        }),
      );
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const detail = (err as { response?: { data?: { error?: string } } })?.response?.data
        ?.error;
      // El 400 se distingue del resto: es un cuerpo inválido (nuestro), no el middleware
      // caído. Se propaga con el motivo para que no se diagnostique como indisponibilidad.
      throw new ServiceUnavailableException(
        status === 400
          ? `El middleware rechazó la auditoría: ${detail ?? 'datos inválidos'}`
          : 'No se pudo registrar la auditoría',
      );
    }
  }
}
