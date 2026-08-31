import { Injectable } from '@nestjs/common';
import { TemplatesClient } from './templates.client';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '../audit/audit.categories';
import { Actor } from '../common/actor';
import { mapDraft, mapEditPolicy, mapTemplate, summarizeByStatus } from './templates.util';
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
  constructor(
    private readonly client: TemplatesClient,
    private readonly audit: AuditService,
  ) {}

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
  async create(input: CreateTemplateInput, actor: Actor): Promise<Template | null> {
    const saved = await this.client.create(aPayloadWaba(input));
    const template = mapTemplate(saved);

    await this.auditar(actor, 'TEMPLATE_CREATE', template?.name ?? input.name, [
      `categoria=${input.category}`,
      `idioma=${input.language}`,
    ]);
    return template;
  }

  /**
   * Edita y reenvia a META.
   *
   * `name` y `language` no se aceptan: META los toma como identidad de la plantilla y no
   * los deja cambiar. Mandarlos daria un rechazo despues de un ciclo de revision.
   */
  async update(id: number, input: UpdateTemplateInput, actor: Actor): Promise<Template | null> {
    const saved = await this.client.update(id, {
      category: input.category ? input.category.trim().toUpperCase() : undefined,
      headerType: input.headerType ?? undefined,
      headerContent: input.headerContent ?? null,
      bodyText: input.bodyText ?? undefined,
      footerText: input.footerText ?? null,
      buttonsJson: input.buttons ? serializeButtons(input.buttons) : undefined,
    });
    if (!saved) return null;

    const template = mapTemplate(saved);
    await this.auditar(actor, 'TEMPLATE_UPDATE', template?.name ?? '', [
      'vuelve a revision de META',
    ]);
    return template;
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
  async saveDraft(
    input: CreateTemplateInput & { draftId?: number | null },
    actor: Actor,
  ): Promise<number | null> {
    const esNuevo = !input.draftId;

    const draftId = await this.client.saveDraft({
      ...aPayloadWaba(input),
      draftId: input.draftId ?? null,
      friendlyTitle: input.friendlyTitle ?? null,
    });

    /*
     * Solo la PRIMERA vez.
     *
     * Un borrador no sale hacia META, asi que por el criterio general no se auditaria.
     * Pero borrarlo si se audita —entra por el mismo endpoint que borrar una plantilla
     * real—, y sin esto la traza podia decir "fulano borro la plantilla X" sin que
     * existiera ningun registro de que X hubiera sido creada.
     *
     * Los guardados siguientes no: el asistente guarda solo cada vez que se alterna de
     * modo, y esas filas no dicen nada que la primera no diga ya.
     */
    if (esNuevo) {
      await this.auditar(actor, 'TEMPLATE_DRAFT_CREATE', input.name, [
        'todavia no se envio a META',
        ...(draftId !== null ? [`borrador=${draftId}`] : []),
      ]);
    }

    return draftId;
  }

  /**
   * Un borrador, listo para rehidratar el formulario.
   *
   * Trae **mas** que el detalle de la plantilla: el titulo, el handle del archivo y las
   * variables con su nombre y su ejemplo. Sin eso, reabrir un borrador obliga a volver a
   * escribir los ejemplos, que META exige.
   */
  async getDraft(id: number) {
    return mapDraft(await this.client.getDraft(id));
  }

  /** Recien aca el borrador se manda a META. */
  async submitDraft(
    id: number,
    input: CreateTemplateInput,
    actor: Actor,
  ): Promise<Template | null> {
    const saved = await this.client.submitDraft(id, aPayloadWaba(input));
    if (!saved) return null;

    const template = mapTemplate(saved);
    await this.auditar(actor, 'TEMPLATE_SUBMIT', template?.name ?? input.name, [
      `borrador=${id}`,
    ]);
    return template;
  }

  /**
   * Borra en META y local.
   *
   * Se busca el nombre **antes** de borrar: despues ya no existe, y sin nombre la
   * traza dice que se borro algo pero no que.
   */
  async remove(id: number, actor: Actor): Promise<void> {
    const detalle = await this.client.getById(id).catch(() => null);
    const name = detalle ? mapTemplate(detalle.template)?.name : null;

    await this.client.remove(id);
    await this.auditar(actor, 'TEMPLATE_DELETE', name ?? String(id), [
      'en META no se deshace',
    ]);
  }

  /** Trae de META lo que haya cambiado alla: aprobaciones, rechazos, pausas. */
  async sync(actor: Actor): Promise<unknown> {
    const result = await this.client.sync();
    await this.auditar(actor, 'TEMPLATE_SYNC', '');
    return result;
  }

  /**
   * Deja la traza de lo que salio hacia META.
   *
   * `safeRecord` y no `record`: la accion ya ocurrio del otro lado, y un fallo de la
   * auditoria no puede revertirla ni romperle la respuesta a quien la hizo.
   *
   * **Solo se audita lo que sale de la aplicacion.** Guardar un borrador no se registra:
   * no llega a META, se guarda muchas veces por plantilla, y llenaria la traza de ruido
   * hasta tapar lo que importa.
   */
  private async auditar(
    actor: Actor,
    action: string,
    name: string,
    detalle: string[] = [],
  ): Promise<void> {
    await this.audit.safeRecord({
      action,
      entity: 'WhatsAppTemplate',
      // El nombre y no el id: es la identidad de la plantilla en META, y el id de WABA
      // no significa nada para quien lee la auditoria desde ITManager.
      entityId: name || null,
      category: AuditCategory.Templates,
      guidUsers: actor.guid ?? null,
      guidApiLoginClients: actor.guidApiLoginClients ?? null,
      actorEmail: actor.email ?? null,
      detail: detalle.length ? detalle.join(' | ') : null,
    });
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
    if (sortBy === 'createdAt') {
      const ta = tiempo(a.createdAt);
      const tb = tiempo(b.createdAt);

      /*
       * Las que no tienen fecha van **al final en las dos direcciones**, asi que su
       * comparacion queda fuera del multiplicador: si entrara, invertir el orden las
       * traeria arriba y taparia justo lo que se buscaba al ordenar por fecha.
       *
       * Son las viejas, sincronizadas de META antes de que WABA guardara la columna.
       */
      if (ta === null || tb === null) {
        if (ta === null && tb === null) return a.name.localeCompare(b.name);
        return ta === null ? 1 : -1;
      }

      // Como fechas y no como texto: los ISO ordenan bien alfabeticamente solo mientras
      // compartan formato, y WABA mezcla lo que creo su panel con lo que trajo de META.
      const cmp = ta - tb;
      return cmp !== 0 ? cmp * dir : a.name.localeCompare(b.name);
    }

    const cmp = (a[sortBy] ?? '').toString().localeCompare((b[sortBy] ?? '').toString());
    // Sin desempate, dos plantillas del mismo idioma bailan entre recargas.
    return cmp !== 0 ? cmp * dir : a.name.localeCompare(b.name);
  });
}

/** Una fecha ISO a milisegundos. `null` si falta o no se entiende. */
function tiempo(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}
