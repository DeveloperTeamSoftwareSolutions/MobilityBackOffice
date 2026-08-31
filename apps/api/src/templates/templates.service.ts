import { Injectable } from '@nestjs/common';
import { TemplatesClient } from './templates.client';
import { mapTemplate, summarizeByStatus } from './templates.util';
import {
  SortableField,
  Template,
  TemplatesPage,
  TemplatesQuery,
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
