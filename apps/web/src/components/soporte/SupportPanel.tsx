import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  getTimeline,
  listDocuments,
  listInconsistent,
  listStatuses,
} from './soporte.api';
import {
  DocumentTimeline as Timeline,
  DocumentType,
  Pagination,
  SortDir,
  SortField,
  StatusCount,
  SupportDocument,
} from './soporte.types';
import { DocumentHeader } from './DocumentHeader';
import { DocumentList } from './DocumentList';
import { DocumentTimeline } from './DocumentTimeline';
import { StatusOverrideModal } from './StatusOverrideModal';
import { DocumentItemsPanel } from './DocumentItemsPanel';
import { DocumentActionsPanel } from './DocumentActionsPanel';
import './soporte.css';

/** Traduce el fallo HTTP al mensaje que ve soporte. */
function errorMessage(err: unknown, contexto: 'listado' | 'documento'): string {
  if (axios.isAxiosError(err)) {
    if (err.response?.status === 404) {
      return 'No existe un documento con ese número. Revisá el tipo (orden o cotización) y el número exacto.';
    }
    if (err.response?.status === 403) {
      return 'Tu rol no tiene acceso a la consola de soporte.';
    }
    if (err.response?.status === 503) {
      return 'El middleware no está disponible. Reintentá en unos minutos.';
    }
  }
  return contexto === 'listado'
    ? 'No se pudo cargar el listado de documentos.'
    : 'No se pudo cargar la bitácora del documento.';
}

/**
 * Alto de fila estimado para calcular cuántas entran en el viewport. No hace falta
 * que sea exacto: solo evita pedir 50 filas en una pantalla que muestra 12.
 */
const ROW_HEIGHT = 44;
const CHROME_HEIGHT = 420;

function pageSizeForViewport(): number {
  const rows = Math.floor((window.innerHeight - CHROME_HEIGHT) / ROW_HEIGHT);
  return Math.min(100, Math.max(10, rows));
}

/**
 * Consola de soporte.
 *
 * Dos vistas: el listado de documentos y, al hacer clic en una fila, su línea de
 * tiempo completa, desde donde se puede forzar su estado. Busqueda, orden y
 * paginacion son server-side.
 */
export function SupportPanel() {
  const [type, setType] = useState<DocumentType>('order');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('documentDate');
  const [sortDir, setSortDir] = useState<SortDir>('DESC');
  const [page, setPage] = useState(1);
  const [limit] = useState(pageSizeForViewport);

  const [documents, setDocuments] = useState<SupportDocument[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [statuses, setStatuses] = useState<StatusCount[]>([]);
  // Modo diagnóstico: en vez del listado normal, solo los documentos cuyo estado
  // guardado no coincide con el calculado.
  const [soloInconsistentes, setSoloInconsistentes] = useState(false);
  const [scan, setScan] = useState<{ scanned: number; total: number; truncated: boolean } | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<SupportDocument | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [includeViews, setIncludeViews] = useState(false);
  // Los mensajes del hilo llevan los motivos de rechazo y las notas del motor de
  // crédito, que suele ser la explicación que busca soporte. Encendidos por
  // default; las consultas no, porque son ruido salvo que se las pida.
  const [includeMessages, setIncludeMessages] = useState(true);
  const [overriding, setOverriding] = useState(false);
  // El override libre queda plegado: puede dejar el documento en un estado que
  // nadie ve, asi que no compite visualmente con las acciones seguras.
  const [avanzadoAbierto, setAvanzadoAbierto] = useState(false);

  /** Debounce de la búsqueda: 300ms y vuelta a la página 1. */
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(searchTimer.current);
  }, [search]);

  /** El catálogo de estados depende del tipo de documento. */
  useEffect(() => {
    let cancelled = false;
    listStatuses(type)
      .then((rows) => {
        if (!cancelled) setStatuses(rows);
      })
      .catch(() => {
        if (!cancelled) setStatuses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError(null);

    if (soloInconsistentes) {
      listInconsistent(type)
        .then((r) => {
          if (cancelled) return;
          setDocuments(r.data);
          setPagination(null);
          setScan({ scanned: r.scanned, total: r.total, truncated: r.truncated });
        })
        .catch((err) => {
          if (cancelled) return;
          setDocuments([]);
          setPagination(null);
          setScan(null);
          setListError(errorMessage(err, 'listado'));
        })
        .finally(() => {
          if (!cancelled) setListLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    setScan(null);
    listDocuments({
      type,
      page,
      limit,
      search: debouncedSearch,
      status,
      sortBy,
      sortDir,
    })
      .then((result) => {
        if (cancelled) return;
        setDocuments(result.data);
        setPagination(result.pagination);
      })
      .catch((err) => {
        if (cancelled) return;
        setDocuments([]);
        setPagination(null);
        setListError(errorMessage(err, 'listado'));
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type, page, limit, debouncedSearch, status, sortBy, sortDir, soloInconsistentes]);

  const loadTimeline = useCallback(
    async (
      document: SupportDocument,
      nextViews: boolean,
      nextMessages: boolean,
    ) => {
      if (!document.documentNumber) return;
      setDetailLoading(true);
      setDetailError(null);
      try {
        setTimeline(
          await getTimeline(
            type,
            document.documentNumber,
            nextViews,
            nextMessages,
          ),
        );
      } catch (err) {
        setTimeline(null);
        setDetailError(errorMessage(err, 'documento'));
      } finally {
        setDetailLoading(false);
      }
    },
    [type],
  );

  function onSelect(document: SupportDocument) {
    setSelected(document);
    setTimeline(null);
    void loadTimeline(document, includeViews, includeMessages);
  }

  function onBack() {
    setSelected(null);
    setTimeline(null);
    setDetailError(null);
  }

  /** Click en una columna: alterna la dirección si ya se ordenaba por ella. */
  function onSort(field: SortField) {
    if (field === sortBy) {
      setSortDir(sortDir === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(field);
      setSortDir('ASC');
    }
    setPage(1);
  }

  /**
   * El estado del documento pudo moverse por un cambio en una linea o por un
   * recalculo. Se refresca la fila seleccionada, el listado y la bitacora.
   */
  function onDocumentStatusChange(nuevoEstado: string | null) {
    if (!selected || !nuevoEstado) return;
    const actualizado = { ...selected, statusCode: nuevoEstado };
    setSelected(actualizado);
    setDocuments((prev) =>
      prev.map((d) => (d.guid === actualizado.guid ? actualizado : d)),
    );
    void loadTimeline(actualizado, includeViews, includeMessages);
  }

  function onToggleViews(next: boolean) {
    setIncludeViews(next);
    if (selected) void loadTimeline(selected, next, includeMessages);
  }

  function onToggleMessages(next: boolean) {
    setIncludeMessages(next);
    if (selected) void loadTimeline(selected, includeViews, next);
  }

  // ---- Vista de detalle ----
  if (selected) {
    return (
      <div className="bo-sp-shell">
        <div className="bo-sp">
          <div className="bo-sp__detail-bar">
            <button type="button" className="bo-sp__back" onClick={onBack}>
              ← Volver al listado
            </button>
          </div>

          {overriding && (
            <StatusOverrideModal
              document={selected}
              type={type}
              onClose={() => setOverriding(false)}
              onApplied={(nuevoEstado) => {
                setOverriding(false);
                // El documento seleccionado quedo desactualizado: se refresca en
                // memoria y se recarga la bitacora para ver el hito recien escrito.
                const actualizado = { ...selected, statusCode: nuevoEstado };
                setSelected(actualizado);
                setDocuments((prev) =>
                  prev.map((d) => (d.guid === actualizado.guid ? actualizado : d)),
                );
                void loadTimeline(actualizado, includeViews, includeMessages);
              }}
            />
          )}

          <div className="bo-sp__toggles">
            <label className="bo-sp__toggle">
              <input
                type="checkbox"
                checked={includeMessages}
                onChange={(e) => onToggleMessages(e.target.checked)}
              />
              <span>
                Incluir mensajes del hilo (motivos de rechazo, notas de crédito)
              </span>
            </label>
            <label className="bo-sp__toggle">
              <input
                type="checkbox"
                checked={includeViews}
                onChange={(e) => onToggleViews(e.target.checked)}
              />
              <span>Incluir consultas (quién miró el documento)</span>
            </label>
          </div>

          {detailError && <p className="bo-sp__error">{detailError}</p>}
          {detailLoading && <p className="bo-sp__empty">Cargando bitácora…</p>}

          {timeline && !detailError && !detailLoading && (
            <>
              <DocumentHeader document={timeline.document} />
              <DocumentActionsPanel
                type={type}
                guid={selected.guid}
                onDocumentStatusChange={onDocumentStatusChange}
              />
              <DocumentItemsPanel
                type={type}
                guid={selected.guid}
                onDocumentStatusChange={onDocumentStatusChange}
              />
              <DocumentTimeline
                events={timeline.events}
                includeViews={includeViews}
              />

              {/*
                El override libre queda al final y plegado. Cumple lo que pedia el
                ticket, pero no es el camino recomendado: es el unico que puede
                dejar el documento en un estado que la proyeccion nunca produciria
                y que, por lo tanto, nadie ve (ni el gerente en su cola).
              */}
              <section className="bo-sp__card">
                <button
                  type="button"
                  className="bo-sp__advanced-toggle"
                  onClick={() => setAvanzadoAbierto((v) => !v)}
                  aria-expanded={avanzadoAbierto}
                >
                  {avanzadoAbierto ? '▾' : '▸'} Avanzado — forzar el estado a mano
                </button>
                {avanzadoAbierto && (
                  <>
                    <p className="bo-sp__modal-danger">
                      Escribe el estado directamente, sin tocar los datos. Puede dejar
                      el documento en un estado que el sistema nunca calcularia: el
                      vendedor lo ve mal, el gerente no lo tiene en su cola y solo
                      soporte puede sacarlo de ahi. Usá las acciones de arriba salvo
                      que sepas exactamente por qué necesitás esto.
                    </p>
                    <div>
                      <button
                        type="button"
                        className="bo-sp__pager-button"
                        onClick={() => setOverriding(true)}
                      >
                        Forzar estado
                      </button>
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    );
  }

  // ---- Vista de listado ----
  return (
    <div className="bo-sp-shell">
      <div className="bo-sp">
        <header className="bo-sp__head">
          <h1 className="bo-sp__title">Consola de soporte</h1>
          <p className="bo-sp__subtitle">
            Trazabilidad completa de órdenes y cotizaciones del flujo Mobility.
            Hacé clic en un documento para ver su recorrido: quién lo creó, qué
            cambió el comercial, cuándo intervino el gerente, rechazos y
            contraofertas.
          </p>
        </header>

        <div className="bo-sp__search">
          <label className="bo-sp__field">
            <span className="bo-sp__label">Tipo</span>
            <select
              className="bo-sp__select"
              value={type}
              onChange={(e) => {
                setType(e.target.value as DocumentType);
                setStatus('');
                setPage(1);
              }}
            >
              <option value="order">Órdenes</option>
              <option value="quote">Cotizaciones</option>
            </select>
          </label>

          <label className="bo-sp__field">
            <span className="bo-sp__label">Estado</span>
            <select
              className="bo-sp__select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {statuses.map((s) => (
                <option key={s.statusCode} value={s.statusCode}>
                  {s.statusCode} ({s.total})
                </option>
              ))}
            </select>
          </label>

          <label className="bo-sp__field bo-sp__field--grow">
            <span className="bo-sp__label">
              Buscar por número, cliente o vendedor
            </span>
            <input
              className="bo-sp__input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ORD-00005234, AGROSAK, vendedor@duwest.com"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="bo-sp__toggles">
          <label className="bo-sp__toggle">
            <input
              type="checkbox"
              checked={soloInconsistentes}
              onChange={(e) => {
                setSoloInconsistentes(e.target.checked);
                setPage(1);
              }}
            />
            <span>
              Solo documentos con el estado desfasado (no coincide con el calculado)
            </span>
          </label>
        </div>

        {scan && (
          <p className="bo-sp__modal-warning">
            {documents.length} de {scan.scanned} documentos revisados tienen el estado
            desfasado.
            {scan.truncated
              ? ` Se revisaron los ${scan.scanned} mas recientes de ${scan.total}: hay mas sin revisar.`
              : ` Se revisaron todos (${scan.total}).`}{' '}
            Entrá a cada uno y usá <strong>Recalcular estado</strong> para corregirlo.
          </p>
        )}

        {listError && <p className="bo-sp__error">{listError}</p>}

        {!listError && (
          <DocumentList
            documents={documents}
            pagination={pagination}
            sortBy={sortBy}
            sortDir={sortDir}
            loading={listLoading}
            onSort={onSort}
            onSelect={onSelect}
            onPage={setPage}
          />
        )}
      </div>
    </div>
  );
}
