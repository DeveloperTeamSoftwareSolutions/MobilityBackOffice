import { Fragment, useCallback, useEffect, useState } from 'react';
import { getStatus, getTemplates } from './plantillas.api';
import {
  SortableField,
  Template,
  TemplatesPage,
  TemplateStatus,
} from './plantillas.types';
import {
  categoryLabel,
  languageLabel,
  statusHint,
  statusLabel,
  statusTone,
  variablesLabel,
} from './plantillas.format';
import { TemplatePreview } from './TemplatePreview';
import './plantillas.css';

const PAGE_SIZE = 25;

/**
 * Plantillas de WhatsApp — consulta.
 *
 * Las plantillas viven en el panel WABA; acá se consumen sus DATOS por HTTP y se arma
 * pantalla propia, igual que hace MobilityManager con las conversaciones. No hay iframe
 * ni segundo login.
 *
 * **Todavía es solo lectura.** Crear y editar necesita endpoints REST que WABA aún no
 * expone (su alta y edición viven en rutas HTML con control de rol). Ver
 * `docs/SPEC_PLANTILLAS_WHATSAPP.md`.
 */
export function PlantillasPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [page, setPage] = useState<TemplatesPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [pageNum, setPageNum] = useState(1);
  const [sortBy, setSortBy] = useState<SortableField>('name');
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>('ASC');
  const [status, setStatus] = useState<TemplateStatus | null>(null);

  useEffect(() => {
    let active = true;
    getStatus()
      .then((c) => active && setConfigured(c))
      .catch(() => active && setConfigured(false));
    return () => {
      active = false;
    };
  }, []);

  // Debounce del buscador: 300ms, y toda búsqueda vuelve a la primera página.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPageNum(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    if (configured !== true) return;
    let active = true;
    setLoading(true);
    setError(null);

    getTemplates({
      page: pageNum,
      limit: PAGE_SIZE,
      search: debounced,
      sortBy,
      sortDir,
      status,
    })
      .then((res) => active && setPage(res))
      .catch(() => {
        if (!active) return;
        setPage(null);
        setError('No se pudieron cargar las plantillas.');
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [configured, pageNum, debounced, sortBy, sortDir, status]);

  useEffect(() => load(), [load]);

  const sort = (field: SortableField) => {
    if (field === sortBy) setSortDir((d) => (d === 'ASC' ? 'DESC' : 'ASC'));
    else {
      setSortBy(field);
      setSortDir('ASC');
    }
    setPageNum(1);
  };

  const filtrarPor = (s: TemplateStatus | null) => {
    setStatus(s);
    setPageNum(1);
  };

  return (
    <>
      <h1 className="bo-page__title">Templates de WhatsApp</h1>
      <p className="bo-page__subtitle">
        Las plantillas aprobadas por META para escribirle a un cliente. Se consultan desde el
        panel de WhatsApp de la empresa.
      </p>

      {configured === false && (
        <div className="bo-card">
          <p className="bo-pl__warn">
            La conexión con el panel de WhatsApp <strong>no está configurada</strong>. Faltan
            <code> WABA_API_URL</code> y <code>WABA_API_KEY</code> en el archivo de entorno del
            API. Hasta entonces esta sección no puede mostrar plantillas.
          </p>
        </div>
      )}

      {configured === true && (
        <>
          {page && <StatusBar page={page} status={status} onFilter={filtrarPor} />}

          <div className="bo-card bo-pl__toolbar">
            <div className="bo-pl__searchbox">
              <label className="bo-pl__label" htmlFor="bo-pl-search">
                Buscar
              </label>
              <input
                id="bo-pl-search"
                type="search"
                className="bo-pl__input"
                placeholder="Nombre, texto del mensaje, categoría…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="bo-card">
            {error && <p className="bo-pl__warn">{error}</p>}
            {loading && !error && <p className="bo-pl__empty">Cargando…</p>}

            {!loading && !error && page && page.data.length === 0 && (
              <p className="bo-pl__empty">
                {page.pagination.total === 0 && !debounced && !status
                  ? 'No hay plantillas cargadas en el panel de WhatsApp.'
                  : 'Ninguna plantilla coincide con la búsqueda o el filtro elegido.'}
              </p>
            )}

            {!loading && !error && page && page.data.length > 0 && (
              <>
                <TemplatesTable
                  rows={page.data}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={sort}
                  abierta={abierta}
                  onToggle={(n) => setAbierta((a) => (a === n ? null : n))}
                />

                <div className="bo-pl__pager">
                  <span className="bo-pl__pagerinfo">
                    {page.pagination.total} plantilla(s) · página {page.pagination.page} de{' '}
                    {page.pagination.totalPages}
                  </span>
                  <div className="bo-pl__pagerbtns">
                    <button
                      type="button"
                      className="bo-pl__pagerbtn"
                      disabled={page.pagination.page <= 1}
                      onClick={() => setPageNum((p) => Math.max(1, p - 1))}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      className="bo-pl__pagerbtn"
                      disabled={page.pagination.page >= page.pagination.totalPages}
                      onClick={() => setPageNum((p) => p + 1)}
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

/**
 * Cuántas hay en cada estado, y cada contador filtra.
 *
 * Cuando la fuente solo devuelve aprobadas, lo dice: si no, la pantalla daría a entender
 * que no hay ninguna en revisión ni rechazada.
 */
function StatusBar({
  page,
  status,
  onFilter,
}: {
  page: TemplatesPage;
  status: TemplateStatus | null;
  onFilter: (s: TemplateStatus | null) => void;
}) {
  const estados = Object.keys(page.summary).sort();

  return (
    <>
      <div className="bo-pl__summary">
        <button
          type="button"
          className={`bo-pl__card${status === null ? ' bo-pl__card--active' : ''}`}
          aria-pressed={status === null}
          onClick={() => onFilter(null)}
        >
          <span className="bo-pl__cardvalue">{page.pagination.total}</span>
          <span className="bo-pl__cardlabel">Todas</span>
        </button>

        {estados.map((e) => {
          const s = e as TemplateStatus;
          const activo = status === s;
          return (
            <button
              key={e}
              type="button"
              className={`bo-pl__card bo-pl__card--${statusTone(s)}${activo ? ' bo-pl__card--active' : ''}`}
              aria-pressed={activo}
              onClick={() => onFilter(activo ? null : s)}
            >
              <span className="bo-pl__cardvalue">{page.summary[e]}</span>
              <span className="bo-pl__cardlabel">{statusLabel(s)}</span>
            </button>
          );
        })}
      </div>

      {page.onlyApproved && (
        <p className="bo-pl__notice">
          El panel de WhatsApp está publicando <strong>solo las plantillas aprobadas</strong>.
          Las que están en revisión o fueron rechazadas existen, pero desde acá no se ven
          todavía.
        </p>
      )}
    </>
  );
}

const COLUMNS: { key: SortableField; label: string }[] = [
  { key: 'name', label: 'Nombre' },
  { key: 'category', label: 'Categoría' },
  { key: 'language', label: 'Idioma' },
  { key: 'status', label: 'Estado' },
];

function TemplatesTable({
  rows,
  sortBy,
  sortDir,
  onSort,
  abierta,
  onToggle,
}: {
  rows: Template[];
  sortBy: SortableField;
  sortDir: 'ASC' | 'DESC';
  onSort: (f: SortableField) => void;
  abierta: string | null;
  onToggle: (name: string) => void;
}) {
  return (
    <div className="bo-pl__tablewrap">
      <table className="bo-pl__table">
        <thead>
          <tr>
            <th scope="col" className="bo-pl__thexpand">
              <span className="bo-pl__sr">Vista previa</span>
            </th>
            {COLUMNS.map((c) => (
              <th key={c.key} scope="col">
                <button
                  type="button"
                  className="bo-pl__sortbtn"
                  onClick={() => onSort(c.key)}
                  aria-sort={
                    sortBy === c.key ? (sortDir === 'ASC' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  {c.label}
                  {sortBy === c.key && (
                    <span className="bo-pl__sortdir" aria-hidden>
                      {sortDir === 'ASC' ? '▲' : '▼'}
                    </span>
                  )}
                </button>
              </th>
            ))}
            <th scope="col">Variables</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const open = abierta === t.name;
            const hint = statusHint(t.status);
            return (
              <Fragment key={t.name}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="bo-pl__expand"
                      aria-expanded={open}
                      onClick={() => onToggle(t.name)}
                    >
                      <span aria-hidden>{open ? '−' : '+'}</span>
                      <span className="bo-pl__sr">
                        {open ? 'Ocultar' : 'Ver'} vista previa de {t.name}
                      </span>
                    </button>
                  </td>
                  <td className="bo-pl__name">{t.name}</td>
                  <td>{categoryLabel(t.category)}</td>
                  <td>{languageLabel(t.language)}</td>
                  <td>
                    <span className={`bo-pl__status bo-pl__status--${statusTone(t.status)}`}>
                      {statusLabel(t.status)}
                    </span>
                    {hint && <span className="bo-pl__statushint">{hint}</span>}
                  </td>
                  <td>{variablesLabel(t)}</td>
                </tr>
                {open && (
                  <tr className="bo-pl__detailrow">
                    <td colSpan={COLUMNS.length + 2}>
                      <TemplatePreview template={t} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
