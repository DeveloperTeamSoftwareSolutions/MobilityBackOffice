import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data';
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

  /**
   * Valida y devuelve el payload que se le mandaria a META.
   *
   * Lo arma WABA con **el mismo codigo del envio real**, no una reconstruccion: asi lo
   * que se muestra en la revision es exactamente lo que se manda. No escribe nada.
   */
  async validate(input: Record<string, unknown>): Promise<{
    valid: boolean;
    errors: string[];
    payload: unknown;
    payloadError: string | null;
  }> {
    this.assertConfigured();

    try {
      const res = await firstValueFrom(
        this.http.post<{
          data?: { valid?: boolean; errors?: string[]; payload?: unknown; payloadError?: string };
        }>(`${this.base()}${TEMPLATES_PATH}/validate`, input, {
          headers: this.headers(),
          timeout: 20000,
        }),
      );
      const d = res.data?.data ?? {};
      return {
        valid: d.valid === true,
        errors: Array.isArray(d.errors) ? d.errors : [],
        payload: d.payload ?? null,
        payloadError: d.payloadError ?? null,
      };
    } catch (err) {
      throw this.wrap(err, 'No se pudo validar la plantilla');
    }
  }

  /**
   * Sube el archivo de ejemplo del encabezado y devuelve el handle de META.
   *
   * META exige un ejemplo del medio para revisar una plantilla con encabezado de
   * imagen, video o documento. El archivo se reenvia a WABA, que es quien tiene la
   * credencial de META: BackOffice no habla con META directamente.
   */
  async uploadSample(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    headerType: string,
  ): Promise<{ handle: string; fileName: string; mimeType: string }> {
    this.assertConfigured();

    const form = new FormData();
    form.append('file', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    form.append('headerType', headerType);

    try {
      const res = await firstValueFrom(
        this.http.post<{ data?: { handle?: string; fileName?: string; mimeType?: string } }>(
          `${this.base()}${TEMPLATES_PATH}/upload-sample`,
          form,
          {
            headers: { ...this.headers(), ...form.getHeaders() },
            // Subir un video puede tardar; y el archivo no debe partirse.
            timeout: 120000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
          },
        ),
      );
      const d = res.data?.data ?? {};
      return {
        handle: d.handle ?? '',
        fileName: d.fileName ?? file.originalname,
        mimeType: d.mimeType ?? file.mimetype,
      };
    } catch (err) {
      throw this.wrap(err, 'No se pudo subir el archivo');
    }
  }

  /** Guarda el avance SIN mandar nada a META. Con `draftId` actualiza ese borrador. */
  async saveDraft(input: Record<string, unknown>): Promise<number | null> {
    this.assertConfigured();

    try {
      const res = await firstValueFrom(
        this.http.post<{ data?: { draftId?: number } }>(
          `${this.base()}${TEMPLATES_PATH}/drafts`,
          input,
          { headers: this.headers(), timeout: 20000 },
        ),
      );
      return res.data?.data?.draftId ?? null;
    } catch (err) {
      throw this.wrap(err, 'No se pudo guardar el borrador');
    }
  }

  /** Recupera un borrador. `null` si no existe o es de otra cuenta. */
  async getDraft(id: number): Promise<Record<string, unknown> | null> {
    this.assertConfigured();

    try {
      const res = await firstValueFrom(
        this.http.get<{ data?: Record<string, unknown> }>(
          `${this.base()}${TEMPLATES_PATH}/drafts/${encodeURIComponent(String(id))}`,
          { headers: this.headers(), timeout: 20000 },
        ),
      );
      return res.data?.data ?? null;
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw this.wrap(err, 'No se pudo abrir el borrador');
    }
  }

  /** Recien aca el borrador se manda a META. */
  async submitDraft(id: number, input: Record<string, unknown>): Promise<WabaTemplateRow | null> {
    this.assertConfigured();

    try {
      const res = await firstValueFrom(
        this.http.post<{ data?: WabaTemplateRow }>(
          `${this.base()}${TEMPLATES_PATH}/drafts/${encodeURIComponent(String(id))}/submit`,
          input,
          { headers: this.headers(), timeout: 30000 },
        ),
      );
      return (res.data?.data ?? null) as WabaTemplateRow | null;
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw this.wrap(err, 'No se pudo enviar el borrador');
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

    /*
     * En un 5xx tambien se conserva el motivo, si WABA lo mando en su sobre JSON.
     *
     * No es un stack trace: WABA arma ese texto con `friendlyError`, que ya extrajo el
     * mensaje de META y le enmascaro el access token. Tirarlo convierte un problema
     * configurable ("token mal formado") en un 503 mudo, imposible de diagnosticar desde
     * la pantalla — que es justo cuando mas hace falta saber que paso.
     */
    const motivo = typeof body?.message === 'string' ? body.message.trim() : '';
    return new ServiceUnavailableException(motivo ? `${fallback}: ${motivo}` : fallback);
  }
}

/** Status HTTP de un error de axios, si lo tiene. */
function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}
