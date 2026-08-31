import { Injectable } from '@nestjs/common';
import { TemplatesClient } from './templates.client';
import { mapEditPolicy, mapTemplate, summarizeByStatus } from './templates.util';
import {
  CreateTemplateInput,
  SortableField,
  Template,
  TemplateButton,
  TemplateDetail,
  TemplatesPage,
  TemplatesQuery,
  UpdateTemplateInput,
} from './templates.types';

/**
 * Plantillas de WhatsApp — lectura.
 *
 * La fuente devuelve la lista completa de una vez (son decenas, no miles), asi que el
 * filtrado, el orden y la paginacion se resuelven aca. Es el mismo criterio que en la
 * matriz de autorizadores: cuando el grano de la fuente no coincide con el de la UI,
 * ensambla el consumidor.
 */
@Injectable()
export class TemplatesService {
  constructor(private readonly client: TemplatesClient) {}

  /** `false` cuando falta `WABA_API_URL` o `WABA_API_KEY`. */
  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  async getAll(query: TemplatesQuery): Promise<TemplatesPage> {
    const rows = await this.client.getTemplates();
    const all = rows
      .map(mapTemplate)
      .filter((t): t is Template => t !== null);

    // El resumen se calcula sobre TODAS: es el semaforo de la cuenta y no debe cambiar
    // mientras se navega o se filtra.
    const summary = summarizeByStatus(all);

    const filtered = all
      .filter((t) => (query.status ? t.status === query.status : true))
      .filter(matches(query.search));

    sortTemplates(filtered, query.sortBy, query.sortDir);

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    const page = Math.min(query.page, totalPages);
    const offset = (page - 1) * query.limit;

    return {
      data: filtered.slice(offset, offset + query.limit),
      pagination: { total, page, limit: query.limit, totalPages },
      summary,
      // Hoy WABA solo publica las aprobadas. Se informa para que la pantalla lo diga en
      // vez de dar a entender que no hay pendientes ni rechazadas.
      onlyApproved: onlyApproved(summary),
    };
  }

  /** Una plantilla por nombre. El nombre es unico por cuenta en META. */
  async getByName(name: string): Promise<Template | null> {
    const rows = await this.client.getTemplates();
    const needle = name.trim().toLowerCase();

    for (const row of rows) {
      const t = mapTemplate(row);
      if (t && t.name.toLowerCase() === needle) return t;
    }
    return null;
  }

  /**
   * Detalle por id, con la politica de edicion.
   *
   * La politica viene de WABA y dice si META permite editarla **ahora**: una en revision
   * no se toca. Viaja con el detalle para que el formulario pueda avisarlo antes de que
   * alguien escriba, en vez de que se entere al guardar.
   */
  async getById(id: number): Promise<TemplateDetail | null> {
    const found = await this.client.getById(id);
    if (!found) return null;

    const template = mapTemplate(found.template);
    if (!template) return null;

    // WABA manda `allowed` y claves i18n; la pantalla necesita `canEdit` y texto.
    return { template, editPolicy: mapEditPolicy(found.editPolicy) };
  }

  /**
   * Crea la plantilla y la manda a META.
   *
   * No "guarda": la envia a revision. `status` lo decide META, por eso no se acepta como
   * entrada. La validacion de fondo la hace WABA (`templateValidator`), que es la misma
   * que usan su asistente y su formulario: no hay dos criterios distintos.
   */
  async create(input: CreateTemplateInput): Promise<Template | null> {
    const saved = await this.client.create(aPayloadWaba(input));
    return mapTemplate(saved);
  }

  /**
   * Edita y reenvia a META.
   *
   * `name` y `language` no se aceptan: META los toma como identidad de la plantilla y no
   * los deja cambiar. Mandarlos daria un rechazo despues de un ciclo de revision.
   */
  async update(id: number, input: UpdateTemplateInput): Promise<Template | null> {
    const saved = await this.client.update(id, {
      category: input.category ? input.category.trim().toUpperCase() : undefined,
      headerType: input.headerType ?? undefined,
      headerContent: input.headerContent ?? null,
      bodyText: input.bodyText ?? undefined,
      footerText: input.footerText ?? null,
      buttonsJson: input.buttons ? serializeButtons(input.buttons) : undefined,
    });
    return saved ? mapTemplate(saved) : null;
  }

  /**
   * Valida y devuelve el payload que se le mandaria a META.
   *
   * Lo arma WABA con el mismo codigo del envio real: lo que se ve en la revision es
   * exactamente lo que se manda, no una reconstruccion que pueda desincronizarse.
   */
  validate(input: CreateTemplateInput) {
    return this.client.validate(aPayloadWaba(input));
  }

  /** Sube el ejemplo del encabezado y devuelve el handle de META. */
  uploadSample(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    headerType: string,
  ) {
    return this.client.uploadSample(file, headerType);
  }

  /**
   * Guarda el avance sin mandar nada a META.
   *
   * Es lo que permite cerrar y seguir despues, y alternar entre el asistente y el
   * modo avanzado sin perder lo cargado.
   */
  saveDraft(input: CreateTemplateInput & { draftId?: number | null }) {
    return this.client.saveDraft({
      ...aPayloadWaba(input),
      draftId: input.draftId ?? null,
      friendlyTitle: input.friendlyTitle ?? null,
    });
  }

  getDraft(id: number) {
    return this.client.getDraft(id);
  }

  /** Recien aca el borrador se manda a META. */
  async submitDraft(id: number, input: CreateTemplateInput): Promise<Template | null> {
    const saved = await this.client.submitDraft(id, aPayloadWaba(input));
    return saved ? mapTemplate(saved) : null;
  }

  remove(id: number): Promise<void> {
    return this.client.remove(id);
  }

  /** Trae de META lo que haya cambiado alla: aprobaciones, rechazos, pausas. */
  sync(): Promise<unknown> {
    return this.client.sync();
  }
}

/**
 * El input de BackOffice al formato que espera WABA.
 *
 * Lo comparten crear, validar, guardar borrador y enviar. Si cada uno armara el suyo,
 * la vista previa del JSON podria mostrar algo distinto de lo que termina enviandose.
 *
 * AUTHENTICATION no lleva cuerpo, encabezado ni botones: META escribe el texto y arma
 * el boton OTP. Mandar esos campos ahi es un rechazo seguro.
 */
function aPayloadWaba(input: CreateTemplateInput): Record<string, unknown> {
  const category = (input.category ?? '').trim().toUpperCase();
  const base = {
    name: (input.name ?? '').trim(),
    language: (input.language ?? '').trim(),
    category,
  };

  if (category === 'AUTHENTICATION') {
    return {
      ...base,
      addSecurityRecommendation: input.addSecurityRecommendation === true,
      codeExpirationMinutes: input.codeExpirationMinutes ?? null,
      otpType: input.otpType ?? 'COPY_CODE',
    };
  }

  return {
    ...base,
    headerType: input.headerType ?? 'NONE',
    headerContent: input.headerContent ?? null,
    // El handle del archivo de ejemplo, cuando el encabezado es multimedia.
    headerHandle: input.headerHandle ?? null,
    bodyText: input.bodyText,
    footerText: input.footerText ?? null,
    buttonsJson: serializeButtons(input.buttons),
    // Sin los ejemplos META rechaza: los usa para revisar la plantilla.
    variables: input.variables ?? [],
  };
}

/**
 * Botones al formato que espera WABA: una cadena JSON.
 *
 * El front manda un array (que es lo natural); WABA guarda y valida una cadena. La
 * conversion vive aca y no en la UI, para que el formulario no tenga que saber como
 * almacena el otro sistema.
 */
function serializeButtons(buttons: TemplateButton[] | undefined): string | null {
  if (!buttons || buttons.length === 0) return null;

  return JSON.stringify(
    buttons.map((b) => {
      const out: Record<string, string> = { type: b.type ?? '', text: b.text ?? '' };
      if (b.url) out.url = b.url;
      // META lo llama `phone_number`, no `phoneNumber`.
      if (b.phoneNumber) out.phone_number = b.phoneNumber;
      return out;
    }),
  );
}

/**
 * `true` si todo lo que llego esta aprobado.
 *
 * Es una inferencia, no un dato: la fuente no dice si filtro. Con el endpoint actual
 * (`findAllApproved`) siempre da `true`; cuando WABA publique todos los estados, pasara
 * a `false` solo y el aviso desaparece sin tocar nada.
 */
function onlyApproved(summary: Record<string, number>): boolean {
  const estados = Object.keys(summary);
  return estados.length > 0 && estados.every((e) => e === 'APPROVED');
}

/** Busca por nombre, texto del cuerpo, categoria e idioma. */
function matches(search: string): (t: Template) => boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return () => true;

  return (t) =>
    t.name.toLowerCase().includes(needle) ||
    (t.bodyText ?? '').toLowerCase().includes(needle) ||
    (t.category ?? '').toLowerCase().includes(needle) ||
    (t.language ?? '').toLowerCase().includes(needle);
}

/** Ordena in-place, con desempate estable por nombre. */
function sortTemplates(
  list: Template[],
  sortBy: SortableField,
  sortDir: 'ASC' | 'DESC',
): void {
  const dir = sortDir === 'DESC' ? -1 : 1;

  list.sort((a, b) => {
    const cmp = (a[sortBy] ?? '')
      .toString()
      .localeCompare((b[sortBy] ?? '').toString());
    // Sin desempate, dos plantillas del mismo idioma bailan entre recargas.
    return cmp !== 0 ? cmp * dir : a.name.localeCompare(b.name);
  });
}
