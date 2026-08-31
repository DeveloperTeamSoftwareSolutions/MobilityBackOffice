import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EditPolicy, WabaTemplateRow } from './templates.types';

/**
 * Cliente hacia la API REST del panel WABA.
 *
 * POR QUE VA DIRECTO Y NO POR EL MIDDLEWARE. BackOffice habla con el middleware para
 * todo lo que es dato de Mobility, pero las plantillas viven en `WhatsAppWABA` y el
 * middleware **no las expone** (solo tiene conversaciones, mensajes y media). Ir por ahi
 * exigiria un endpoint nuevo en un tercer repo para leer algo que WABA ya publica.
 *
 * Es el mismo criterio con el que MobilityManager consume WABA: se consumen los DATOS y
 * se arma UI propia, en vez de embeber la pantalla ajena. La diferencia es el salto
 * intermedio, y esta anotada en `docs/SPEC_PLANTILLAS_WHATSAPP.md`.
 */
const TEMPLATES_PATH = '/api/templates';

/**
 * Forma de la respuesta de WABA (`responseHelper`): `{ success, message, data }`.
 *
 * El `data` tiene dos formas segun el modo del endpoint:
 * - **sin query params**: array plano de aprobadas (el contrato viejo, que usa el
 *   selector de envio del propio panel).
 * - **con query params**: `{ data, pagination }` con todos los estados.
 *
 * BackOffice usa el segundo, pero acepta los dos: si algun dia se llama sin params,
 * sigue funcionando en vez de devolver vacio en silencio.
 */
interface WabaResponse {
  success?: boolean;
  message?: string;
  data?: WabaTemplateRow[] | { data?: WabaTemplateRow[]; pagination?: unknown };
}

@Injectable()
export class TemplatesClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** Base del panel WABA, sin barra final. `''` si no esta configurado. */
  private base(): string {
    return (this.config.get<string>('waba.apiUrl') ?? '').replace(/\/+$/, '');
  }

  private apiKey(): string {
    return this.config.get<string>('waba.apiKey') ?? '';
  }

  /** `true` cuando hay URL y key: sin las dos, la seccion no puede funcionar. */
  isConfigured(): boolean {
    return !!this.base() && !!this.apiKey();
  }

  /**
   * Las plantillas de la cuenta WABA asociada a la API key.
   *
   * **La cuenta es implicita en la key**: WABA la resuelve con
   * `wabaAccountModel.findByApiKey()`, asi que aca no se manda ningun identificador de
   * cuenta. Si mañana hicieran falta varias cuentas, hace falta una key por cuenta.
   *
   * Se pide con `status=all` para traer **todos los estados**. Sin ese parametro, WABA
   * devuelve solo las aprobadas — que es el contrato viejo, el que usa el selector de
   * envio de su propio panel. Las PENDING y las rechazadas son justamente las que hay
   * que atender desde una pantalla de gestion.
   *
   * `limit` alto porque la paginacion se resuelve en BackOffice: son decenas de
   * plantillas, no miles, y el resumen por estado necesita verlas todas.
   */
  async getTemplates(): Promise<WabaTemplateRow[]> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'El panel de WhatsApp no está configurado',
      );
    }

    try {
      const res = await firstValueFrom(
        this.http.get<WabaResponse>(`${this.base()}${TEMPLATES_PATH}`, {
          params: { status: 'all', limit: 200 },
          headers: {
            'x-api-key': this.apiKey(),
            // Identifica a BackOffice en los `InternalApiLogs` de WABA. Sin esto su
            // auditoria no distingue quien llamo.
            'x-source-app': 'MobilityBackOffice',
          },
          timeout: 20000,
        }),
      );

      const payload = res.data?.data;
      // Modo gestion: `{ data, pagination }`.
      if (payload && !Array.isArray(payload) && Array.isArray(payload.data)) {
        return payload.data;
      }
      // Modo compat: array plano. Se acepta para no romper si el endpoint cambia.
      return Array.isArray(payload) ? payload : [];
    } catch {
      throw new ServiceUnavailableException(
        'No se pudieron obtener las plantillas de WhatsApp',
      );
    }
  }

  /** Detalle + politica de edicion. `null` si no existe o es de otra cuenta. */
  async getById(id: number): Promise<{
    template: WabaTemplateRow;
    editPolicy: EditPolicy | null;
  } | null> {
    this.assertConfigured();

    try {
      const res = await firstValueFrom(
        this.http.get<{ data?: { template?: WabaTemplateRow; editPolicy?: EditPolicy } }>(
          `${this.base()}${TEMPLATES_PATH}/${encodeURIComponent(String(id))}`,
          { headers: this.headers(), timeout: 20000 },
        ),
      );
      const t = res.data?.data?.template;
      return t ? { template: t, editPolicy: res.data?.data?.editPolicy ?? null } : null;
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw this.wrap(err, 'No se pudo obtener la plantilla');
    }
  }

  /**
   * Crea la plantilla y la manda a META para aprobacion.
   *
   * WABA valida antes de enviar (`templateValidator`), asi que un payload invalido
   * vuelve como 400 con el detalle. Eso se propaga tal cual: son errores que quien
   * escribe la plantilla puede corregir, no fallas del servidor.
   */
  async create(input: Record<string, unknown>): Promise<WabaTemplateRow> {
    this.assertConfigured();

    try {
      const res = await firstValueFrom(
        this.http.post<{ data?: WabaTemplateRow }>(
          `${this.base()}${TEMPLATES_PATH}`,
          input,
          { headers: this.headers(), timeout: 30000 },
        ),
      );
      return (res.data?.data ?? {}) as WabaTemplateRow;
    } catch (err) {
      throw this.wrap(err, 'No se pudo crear la plantilla');
    }
  }

  /** Edita y reenvia a META. `null` si la plantilla no existe. */
  async update(id: number, input: Record<string, unknown>): Promise<WabaTemplateRow | null> {
    this.assertConfigured();

    try {
      const res = await firstValueFrom(
        this.http.put<{ data?: WabaTemplateRow }>(
          `${this.base()}${TEMPLATES_PATH}/${encodeURIComponent(String(id))}`,
          input,
          { headers: this.headers(), timeout: 30000 },
        ),
      );
      return (res.data?.data ?? null) as WabaTemplateRow | null;
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw this.wrap(err, 'No se pudo editar la plantilla');
    }
  }

  /** Borra en META y local. */
  async remove(id: number): Promise<void> {
    this.assertConfigured();

    try {
      await firstValueFrom(
        this.http.delete(`${this.base()}${TEMPLATES_PATH}/${encodeURIComponent(String(id))}`, {
          headers: this.headers(),
          timeout: 30000,
        }),
      );
    } catch (err) {
      throw this.wrap(err, 'No se pudo eliminar la plantilla');
    }
  }

  /** Trae de META lo que haya cambiado alla (aprobaciones, rechazos). */
  async sync(): Promise<unknown> {
    this.assertConfigured();

    try {
      const res = await firstValueFrom(
        this.http.post<{ data?: unknown }>(
          `${this.base()}${TEMPLATES_PATH}/sync`,
          {},
          { headers: this.headers(), timeout: 60000 },
        ),
      );
      return res.data?.data ?? {};
    } catch (err) {
      throw this.wrap(err, 'No se pudo sincronizar con META');
    }
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('El panel de WhatsApp no está configurado');
    }
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKey(),
      // Identifica a BackOffice en los `InternalApiLogs` de WABA.
      'x-source-app': 'MobilityBackOffice',
    };
  }

  /**
   * Traduce el error de WABA a uno de Nest.
   *
   * Los 4xx se propagan con su mensaje: son cosas que quien usa la pantalla puede
   * corregir (un texto muy largo, una plantilla en revision). Convertirlos en un 503
   * generico escondería justamente la informacion util.
   */
  private wrap(err: unknown, fallback: string): Error {
    const status = statusOf(err);
    const body = (err as { response?: { data?: { message?: string; errors?: unknown } } })
      ?.response?.data;
    const message = body?.message || fallback;

    if (status === 409) return new ConflictException(message);
    if (status && status >= 400 && status < 500) {
      return new BadRequestException(
        body?.errors ? { message, errors: body.errors } : message,
      );
    }
    return new ServiceUnavailableException(fallback);
  }
}

/** Status HTTP de un error de axios, si lo tiene. */
function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}
