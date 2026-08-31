import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  createTemplate,
  deleteTemplate,
  getStatus,
  getTemplateDetail,
  getTemplates,
  mensajesDeError,
  syncTemplates,
  updateTemplate,
} from './plantillas.api';
import {
  CreateTemplatePayload,
  EditPolicy,
  SortableField,
  Template,
  TemplateFormState,
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
import { TemplateForm } from './TemplateForm';
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

  // `null` = no hay formulario. `{ template: null }` = alta.
  const [editando, setEditando] = useState<{
    template: Template | null;
    editPolicy: EditPolicy | null;
  } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [erroresServidor, setErroresServidor] = useState<string[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);

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

  const abrirAlta = () => {
    setErroresServidor([]);
    setAviso(null);
    setEditando({ template: null, editPolicy: null });
  };

  /**
   * Abre la edición pidiendo el detalle.
   *
   * Se consulta antes de mostrar el formulario para traer la política de META: si la
   * plantilla está en revisión no se puede editar, y es mejor decirlo de entrada que
   * dejar que alguien escriba y falle al guardar.
   */
  const abrirEdicion = async (t: Template) => {
    if (t.id === null) return;
    setErroresServidor([]);
    setAviso(null);
    try {
      const detalle = await getTemplateDetail(t.id);
      setEditando({ template: detalle.template, editPolicy: detalle.editPolicy });
    } catch {
      // Sin el detalle se abre igual: el servidor rechazará si no corresponde.
      setEditando({ template: t, editPolicy: null });
    }
  };

  /** El formulario al payload del API. La expresión numérica se convierte acá. */
  const aPayload = (f: TemplateFormState): CreateTemplatePayload => {
    const esAuth = f.category === 'AUTHENTICATION';
    const base = { name: f.name.trim(), language: f.language, category: f.category };

    if (esAuth) {
      const mins = f.codeExpirationMinutes.trim();
      return {
        ...base,
        addSecurityRecommendation: f.addSecurityRecommendation,
        codeExpirationMinutes: mins === '' ? null : Number(mins),
        otpType: f.otpType,
      };
    }

    return {
      ...base,
      headerType: f.headerType,
      headerContent: f.headerType === 'TEXT' ? f.headerContent : null,
      bodyText: f.bodyText,
      footerText: f.footerText.trim() || null,
      buttons: f.buttons,
    };
  };

  const guardar = async (f: TemplateFormState) => {
    setGuardando(true);
    setErroresServidor([]);
    try {
      const payload = aPayload(f);
      if (editando?.template?.id) {
        const { name: _n, language: _l, ...resto } = payload;
        await updateTemplate(editando.template.id, resto);
        setAviso('Se envió a revisión de META. Puede tardar en aprobarse.');
      } else {
        await createTemplate(payload);
        setAviso('Plantilla enviada a revisión de META. Puede tardar en aprobarse.');
      }
      setEditando(null);
      load();
    } catch (err) {
      setErroresServidor(mensajesDeError(err));
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (t: Template) => {
    if (t.id === null) return;
    // Borrar en META no se deshace: se pide confirmación explícita.
    const ok = window.confirm(
      `¿Eliminar la plantilla "${t.name}"? Se borra también en META y no se puede deshacer.`,
    );
    if (!ok) return;

    try {
      await deleteTemplate(t.id);
      setAviso('Plantilla eliminada.');
      load();
    } catch (err) {
      setAviso(mensajesDeError(err)[0]);
    }
  };

  const sincronizar = async () => {
    setAviso(null);
    try {
      await syncTemplates();
      setAviso('Sincronizado con META.');
      load();
    } catch (err) {
      setAviso(mensajesDeError(err)[0]);
    }
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

      {configured === true && editando && (
        <div className="bo-card">
          <TemplateForm
            template={editando.template}
            editPolicy={editando.editPolicy}
            onCancel={() => setEditando(null)}
            onSubmit={guardar}
            saving={guardando}
            serverErrors={erroresServidor}
          />
        </div>
      )}

      {configured === true && !editando && (
        <>
          {aviso && <p className="bo-pl__notice">{aviso}</p>}

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

            <div className="bo-pl__actions">
              <button type="button" className="bo-pl__btn" onClick={sincronizar}>
                Sincronizar con META
              </button>
              <button
                type="button"
                className="bo-pl__btn bo-pl__btn--primary"
                onClick={abrirAlta}
              >
                Nueva plantilla
              </button>
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
                  onEdit={abrirEdicion}
                  onDelete={eliminar}
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
  onEdit,
  onDelete,
}: {
  rows: Template[];
  sortBy: SortableField;
  sortDir: 'ASC' | 'DESC';
  onSort: (f: SortableField) => void;
  abierta: string | null;
  onToggle: (name: string) => void;
  onEdit: (t: Template) => void;
  onDelete: (t: Template) => void;
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
            <th scope="col">
              <span className="bo-pl__sr">Acciones</span>
            </th>
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
                  <td className="bo-pl__rowactions">
                    <button
                      type="button"
                      className="bo-pl__btn bo-pl__btn--sm"
                      onClick={() => onEdit(t)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="bo-pl__btn bo-pl__btn--sm bo-pl__btn--danger"
                      onClick={() => onDelete(t)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
                {open && (
                  <tr className="bo-pl__detailrow">
                    <td colSpan={COLUMNS.length + 3}>
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
