import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Entrada de auditoría central (`AuditLogs`, tabla compartida con ITManager y
 * MobilityManager). Las columnas son genéricas a propósito:
 * `entity`/`entityId`/`action`/`detail`/`category` sirven para cualquier dominio
 * sin agregar columnas específicas de una app. El `detail` lo compone cada dominio.
 */
export interface AuditEntry {
  action: string;
  entity: string;
  category: string;
  guidUsers?: string | null;
  entityId?: string | null;
  detail?: string | null;
  /** Por defecto toma `itmanager.appId` (config) → 'MobilityBackOffice'. */
  appId?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Escritura centralizada en `AuditLogs`. Único punto que conoce el mapeo a la tabla
 * (evita duplicar el `prisma.auditLogs.create` en cada dominio).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Registra el evento. Propaga si el insert falla: usar en flujos donde la auditoría
   * es parte del contrato (ej. login). Para acciones de negocio ya confirmadas usar
   * `safeRecord` (best-effort) para no romper la operación por un fallo del audit.
   */
  async record(entry: AuditEntry): Promise<void> {
    const now = BigInt(Date.now());
    const appId =
      entry.appId ??
      this.config.get<string>('itmanager.appId') ??
      'MobilityBackOffice';

    await this.prisma.auditLogs.create({
      data: {
        guidUsers: entry.guidUsers ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        detail: entry.detail ?? null,
        category: entry.category,
        appId,
        timeStamp: now,
        serverTimestamp: now,
      },
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
