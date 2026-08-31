import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  aPayload,
  createTemplate,
  deleteTemplate,
  getStatus,
  getDraft,
  getTemplateDetail,
  getTemplates,
  mensajesDeError,
  submitDraft,
  syncTemplates,
  updateTemplate,
} from './plantillas.api';
import {
  EditPolicy,
  SortableField,
  Template,
  TemplateDraft,
  TemplateFormState,
  TemplatesPage,
  TemplateStatus,
} from './plantillas.types';
import {
  categoryLabel,
  editableSegunEstado,
  fechaCorta,
  motivoNoEditable,
  languageLabel,
  statusHint,
  statusLabel,
  statusTone,
  variablesLabel,
} from './plantillas.format';
import { TemplatePreview } from './TemplatePreview';
import { TemplateEditor } from './TemplateEditor';
import './plantillas.css';

const PAGE_SIZE = 25;

/**
 * Plantillas de WhatsApp — consulta.
 *
 * Las plantillas viven en el panel WABA; acá se consumen sus DATOS por HTTP y se arma
 * pantalla propia, igual que hace MobilityManager con las conversaciones. No hay iframe
 * ni segundo login.
 *
 * Crear, editar y enviar a META tambien pasan por aca: los endpoints REST se agregaron
 * del lado de WABA. Ver `docs/SPEC_PLANTILLAS_WHATSAPP.md`.
 */
export function PlantillasPanel() {
  /**
   * Si la seccion puede funcionar.
   *
   * Cuatro estados y no dos, porque "WABA no esta configurado" y "el API no contesta"
   * se arreglan de formas muy distintas y antes se veian igual: cualquier fallo caia en
   * 'sin-configurar' y mandaba a alguien a revisar un `.env` que estaba bien.
   */
  const [configured, setConfigured] = useState<
    'cargando' | 'ok' | 'sin-configurar' | 'sin-respuesta'
  >('cargando');
  const [page, setPage] = useState<TemplatesPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  // `null` = no hay formulario. `{ template: null }` = alta.
  const [editando, setEditando] = useState<{
    template: Template | null;
    editPolicy: EditPolicy | null;
    /** Presente solo cuando lo que se abre es un borrador. */
    draft: TemplateDraft | null;
  } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [erroresServidor, setErroresServidor] = useState<string[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [pageNum, setPageNum] = useState(1);
  // Las mas nuevas arriba: en una lista que crece, lo ultimo que se hizo es lo que se
  // viene a buscar.
  const [sortBy, setSortBy] = useState<SortableField>('createdAt');
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>('DESC');
  const [status, setStatus] = useState<TemplateStatus | null>(null);

  useEffect(() => {
    let active = true;
    getStatus()
      .then((c) => active && setConfigured(c ? 'ok' : 'sin-configurar'))
      // El API no contesto: no se sabe si WABA esta configurado o no.
      .catch(() => active && setConfigured('sin-respuesta'));
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
    if (configured !== 'ok') return;
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
      // Por fecha se arranca de lo mas nuevo; por texto, alfabetico: una lista de
      // nombres al reves no la espera nadie.
      setSortDir(field === 'createdAt' ? 'DESC' : 'ASC');
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
    setEditando({ template: null, editPolicy: null, draft: null });
  };

  /**
   * Abre la edición pidiendo el detalle.
   *
   * Se consulta antes de mostrar el formulario para traer la política de META: si la
   * plantilla está en revisión no se puede editar, y es mejor decirlo de entrada que
   * dejar que alguien escriba y falle al guardar.
   *
   * Si es un **borrador**, además se pide el borrador entero. El detalle no alcanza: no
   * tiene el título, ni el archivo del encabezado, ni el **ejemplo de cada variable**
   * —solo los números—, y META exige los ejemplos. Reabrir por el detalle convertía
   * "seguir mañana" en "reescribir todo".
   */
  const abrirEdicion = async (t: Template) => {
    if (t.id === null) return;
    setErroresServidor([]);
    setAviso(null);
    try {
      const detalle = await getTemplateDetail(t.id);

      // Si META no la deja editar, no se abre el formulario: completar algo que va a
      // ser rechazado es peor que no poder empezar.
      if (detalle.editPolicy && detalle.editPolicy.canEdit === false) {
        setAviso(
          detalle.editPolicy.reason ??
            'META no permite editar esta plantilla en este momento.',
        );
        return;
      }

      // Un borrador se rehidrata de su propio endpoint. Si falla, se abre igual con lo
      // que hay: quedarse sin poder abrirlo sería peor que abrirlo incompleto.
      let draft: TemplateDraft | null = null;
      if (detalle.template.status === 'DRAFT' && detalle.template.id !== null) {
        try {
          draft = await getDraft(detalle.template.id);
        } catch {
          setAviso(
            'No se pudo recuperar todo el borrador. Revisá los ejemplos de las variables antes de enviarlo.',
          );
        }
      }

      setEditando({ template: detalle.template, editPolicy: detalle.editPolicy, draft });
    } catch {
      // Sin el detalle se abre igual: el servidor rechazará si no corresponde.
      setEditando({ template: t, editPolicy: null, draft: null });
    }
  };

  /**
   * Manda la plantilla a META.
   *
   * Tres caminos, no dos, porque un borrador **nunca estuvo en META**:
   *
   * - Alta: `POST` crea y envía.
   * - Borrador: `submit` lo envía por primera vez y lo promueve. Un `PUT` acá lo guardaba
   *   local y lo dejaba en `DRAFT` en silencio: la pantalla decía "enviada a revisión" y
   *   a META no había llegado nada.
   * - Plantilla que ya existe en META: `PUT`, que la devuelve a revisión.
   */
  /**
   * Cierra el editor y vuelve a pedir la lista.
   *
   * Recargar no es opcional: mientras el editor estuvo abierto se pudieron guardar
   * borradores, y la lista solo se refrescaba al **enviar** una plantilla. El borrador
   * quedaba creado del lado del servidor y no aparecia en pantalla, que se lee como
   * "no se guardo".
   */
  const cerrarEditor = () => {
    setEditando(null);
    load();
  };

  const guardar = async (f: TemplateFormState) => {
    setGuardando(true);
    setErroresServidor([]);
    try {
      const payload = aPayload(f);
      const id = editando?.template?.id ?? null;
      const esBorrador = editando?.template?.status === 'DRAFT';

      if (id !== null && esBorrador) {
        await submitDraft(id, payload);
        setAviso('Borrador enviado a revisión de META. Puede tardar en aprobarse.');
      } else if (id !== null) {
        // `name` e `language` no viajan: META los toma como identidad de la plantilla.
        const { name: _n, language: _l, ...resto } = payload;
        await updateTemplate(id, resto);
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

      {configured === 'sin-configurar' && (
        <div className="bo-card">
          <p className="bo-pl__warn">
            La conexión con el panel de WhatsApp <strong>no está configurada</strong>. Faltan
            <code> WABA_API_URL</code> y <code>WABA_API_KEY</code> en el archivo de entorno del
            API. Hasta entonces esta sección no puede mostrar plantillas.
          </p>
        </div>
      )}

      {/*
        * No es lo mismo que lo anterior: acá no sabemos si WABA está configurado, porque
        * el API ni siquiera contestó. Decir "falta configurar" mandaría a revisar un
        * archivo que probablemente esté bien.
        */}
      {configured === 'sin-respuesta' && (
        <div className="bo-card">
          <p className="bo-pl__warn">
            <strong>El servidor no responde.</strong> No se pudo consultar el estado de la
            sección. Si el problema sigue, revisá que el API esté corriendo y volvé a
            cargar la página.
          </p>
        </div>
      )}

      {configured === 'ok' && aviso && <p className="bo-pl__notice">{aviso}</p>}

      {configured === 'ok' && editando && (
        <div className="bo-card">
          <TemplateEditor
            template={editando.template}
            editPolicy={editando.editPolicy}
            draft={editando.draft}
            onCancel={cerrarEditor}
            onSubmit={guardar}
            saving={guardando}
            serverErrors={erroresServidor}
          />
        </div>
      )}

      {configured === 'ok' && !editando && (
        <>
          {page?.onlyApproved && (
            <p className="bo-pl__notice">
              El panel de WhatsApp está publicando <strong>solo las plantillas aprobadas</strong>.
              Las que están en revisión o fueron rechazadas existen, pero desde acá no se ven
              todavía.
            </p>
          )}

          <div className="bo-card bo-pl__toolbar">
            <div className="bo-pl__searchbox">
              <label className="bo-pl__label" htmlFor="bo-pl-search">
                Buscar
              </label>
              <input
                id="bo-pl-search"
                type="search"
                className="bo-pl__input"
                placeholder="Nombre o texto del mensaje…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="bo-pl__filterbox">
              <label className="bo-pl__label" htmlFor="bo-pl-status">
                Estado
              </label>
              <select
                id="bo-pl-status"
                className="bo-pl__input"
                value={status ?? ''}
                onChange={(e) =>
                  filtrarPor(e.target.value === '' ? null : (e.target.value as TemplateStatus))
                }
              >
                <option value="">Todos</option>
                <option value="APPROVED">Aprobadas</option>
                <option value="PENDING">En revisión</option>
                <option value="REJECTED">Rechazadas</option>
                <option value="DRAFT">Borradores</option>
                <option value="PAUSED">Pausadas</option>
                <option value="DISABLED">Deshabilitadas</option>
              </select>
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

const COLUMNS: { key: SortableField; label: string }[] = [
  { key: 'name', label: 'Nombre' },
  { key: 'category', label: 'Categoría' },
  { key: 'language', label: 'Idioma' },
  { key: 'status', label: 'Estado' },
  // Al final: la lista se lee de izquierda a derecha por lo que identifica la plantilla,
  // y la fecha es contexto. Pero tiene que estar, porque es el orden por defecto y una
  // lista ordenada por algo que no se ve parece desordenada.
  { key: 'createdAt', label: 'Creada' },
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
                  <td className="bo-pl__date" title={t.createdAt ?? undefined}>
                    {fechaCorta(t.createdAt)}
                  </td>
                  <td className="bo-pl__actionscell">
                    {/*
                      * Una plantilla en revision no se ofrece para editar: META no acepta
                      * cambios hasta que termine. Es solo el estado; la autoridad es la
                      * politica que trae el detalle, que ademas sabe del cupo.
                      */}
                    <button
                      type="button"
                      className="bo-pl__btn bo-pl__btn--sm"
                      onClick={() => onEdit(t)}
                      disabled={!editableSegunEstado(t.status)}
                      title={
                        editableSegunEstado(t.status) ? undefined : motivoNoEditable(t.status)
                      }
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
