import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { WabaTemplateRow } from './templates.types';

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

/** Forma de la respuesta de WABA: `{ success, message, data }` (su `responseHelper`). */
interface WabaResponse {
  success?: boolean;
  message?: string;
  data?: WabaTemplateRow[];
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
   * OJO: hoy el endpoint usa `findAllApproved`, o sea `WHERE Status = 'APPROVED'`. Las
   * PENDING y REJECTED **no llegan**, y son justo las que habria que atender. El service
   * lo propaga a la UI en vez de dejar creer que no existen.
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
          headers: {
            'x-api-key': this.apiKey(),
            // Identifica a BackOffice en los `InternalApiLogs` de WABA. Sin esto su
            // auditoria no distingue quien llamo.
            'x-source-app': 'MobilityBackOffice',
          },
          timeout: 20000,
        }),
      );

      return Array.isArray(res.data?.data) ? res.data.data : [];
    } catch {
      throw new ServiceUnavailableException(
        'No se pudieron obtener las plantillas de WhatsApp',
      );
    }
  }
}
