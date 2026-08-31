import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditClient } from './audit.client';
import { AuditCategory } from './audit.categories';

/**
 * Entrada de auditoría central (`AuditLogs`, tabla compartida con ITManager y
 * MobilityManager). Las columnas son genéricas a propósito:
 * `entity`/`entityId`/`action`/`detail`/`category` sirven para cualquier dominio sin
 * agregar columnas específicas de una app. El `detail` lo compone cada dominio.
 */
export interface AuditEntry {
  action: string;
  entity: string;
  category: AuditCategory;
  guidUsers?: string | null;
  /** Cliente dueno de la fila. Sin el, ITManager no la muestra. */
  guidApiLoginClients?: string | null;
  /** Email del actor, en su columna propia. */
  actorEmail?: string | null;
  entityId?: string | null;
  detail?: string | null;
  /** Por defecto toma `itmanager.appId` (config) → 'MobilityBackOffice'. */
  appId?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Escritura centralizada en `AuditLogs`. Único punto que conoce el mapeo (evita duplicar
 * la llamada en cada dominio). Lo consume el login (auth).
 *
 * Escribe **por el middleware**, no contra SQL Server: `AuditLogs` es una tabla central y
 * compartida cuyo dueño es el MW. Además, así la escritura queda atribuida en sus
 * `ApiLogs` —el header `x-source-app` viaja en el cliente— que era justamente lo que se
 * perdía escribiendo directo a la base.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly client: AuditClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * Registra el evento. Propaga si el insert falla: usar en flujos donde la auditoría
   * es parte del contrato (ej. login). Para acciones de negocio ya confirmadas usar
   * `safeRecord` (best-effort) para no romper la operación por un fallo del audit.
   */
  async record(entry: AuditEntry): Promise<void> {
    const appId =
      entry.appId ?? this.config.get<string>('itmanager.appId') ?? 'MobilityBackOffice';

    // Los timestamps ya NO se mandan: los pone el middleware con el reloj del servidor
    // de base. Antes los ponía BackOffice con `Date.now()`, así que la hora de la
    // auditoría era la del proceso que auditaba y no la de la base donde queda la fila.
    await this.client.create({
      guidUsers: entry.guidUsers ?? null,
      guidApiLoginClients: entry.guidApiLoginClients ?? null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      detail: entry.detail ?? null,
      category: entry.category,
      appId,
    });
  }

  /**
   * Best-effort: registra y, si falla, loguea el error sin propagarlo. Para auditar
   * acciones de negocio ya ejecutadas (el CRUD ya ocurrió; un fallo del audit central
   * no debe revertir ni romper la respuesta al usuario).
   */
  async safeRecord(entry: AuditEntry): Promise<void> {
    try {
      await this.record(entry);
    } catch (err) {
      this.logger.error(
        `No se pudo auditar ${entry.action} (${entry.entity}): ${errorMessage(err)}`,
      );
    }
  }
}
