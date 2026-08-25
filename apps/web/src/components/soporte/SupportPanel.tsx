import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { getTimeline, listDocuments, listStatuses } from './soporte.api';
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
 * Consola de soporte (fase 1: solo lectura).
 *
 * Dos vistas: el listado de documentos y, al hacer clic en una fila, su línea de
 * tiempo completa. La búsqueda, el orden y la paginación son server-side.
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
  }, [type, page, limit, debouncedSearch, status, sortBy, sortDir]);

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
          <button type="button" className="bo-sp__back" onClick={onBack}>
            ← Volver al listado
          </button>

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
              <DocumentTimeline
                events={timeline.events}
                includeViews={includeViews}
              />
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
