import { useEffect, useState } from 'react';
import { getCenters, setCenterRestricted } from './warehouses.api';
import { Center, CenterSortField, Pagination, SortDir } from './warehouses.types';
import { apiErrorMessage } from '../../api/authApi';
import { IconChevronRight, IconSortArrow } from '../layout/icons';

const PAGE_SIZE = 50;
const EMPTY: Pagination = { total: 0, page: 1, limit: PAGE_SIZE, totalPages: 0 };

/** Encabezados ordenables. El `sortBy` viaja al servidor validado contra esta misma lista. */
const COLUMNS: {
  col: CenterSortField;
  label: string;
  num: boolean;
  title?: string;
}[] = [
  { col: 'companyCode', label: 'Sociedad', num: false },
  { col: 'centerCode', label: 'Centro de distribución', num: false },
  { col: 'warehouseCount', label: 'Almacenes', num: true },
  {
    col: 'restrictedCount',
    label: 'Reservados',
    num: true,
    title: 'Almacenes reservados a clientes o grupos puntuales',
  },
  { col: 'restricted', label: 'Estado del centro', num: false },
];

/**
 * Vista inicial: centros de distribución del alcance del logueado, ordenados por sociedad.
 *
 * Cada fila muestra dos cosas que NO son lo mismo:
 *   · **Reservados** — cuántos almacenes del centro están reservados a clientes o grupos.
 *   · **Estado del centro** — el CDI ENTERO fuera de circulación, para todos, sin reserva.
 *
 * Click en la fila → almacenes del centro. El toggle de restricción NO entra al drill.
 */
export function CentersList({ onSelect }: { onSelect: (c: Center) => void }) {
  const [rows, setRows] = useState<Center[]>([]);
  const [pagination, setPagination] = useState<Pagination>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<CenterSortField>('companyCode');
  const [sortDir, setSortDir] = useState<SortDir>('ASC');
  /** Centro con la confirmación de restricción abierta (clave `sociedad-centro`). */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Cambiar la búsqueda o el orden vuelve a la página 1: quedarse en la 4 después de
  // reordenar deja al usuario mirando el medio de una lista que ya no es la que ordenó.
  useEffect(() => {
    setPage(1);
  }, [search, sortBy, sortDir]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const t = setTimeout(
      () => {
        getCenters(search, page, PAGE_SIZE, sortBy, sortDir)
          .then((r) => {
            if (!active) return;
            setRows(r.data);
            setPagination(r.pagination);
          })
          .catch((e) => {
            if (active) setError(apiErrorMessage(e, 'No se pudieron cargar los centros'));
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      search ? 300 : 0,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [page, search, sortBy, sortDir]);

  /**
   * Click en una cabecera. La misma columna alterna ASC/DESC; una columna nueva arranca en
   * ASC, que es lo que espera quien recién ordena por ella.
   */
  const ordenarPor = (col: CenterSortField) => {
    if (col === sortBy) setSortDir((d) => (d === 'ASC' ? 'DESC' : 'ASC'));
    else {
      setSortBy(col);
      setSortDir('ASC');
    }
  };

  const keyOf = (c: Center) => `${c.companyCode}-${c.centerCode}`;

  const cerrarConfirmacion = () => {
    setConfirming(null);
    setReason('');
  };

  /**
   * Aplica el toggle y refleja el resultado en la fila sin recargar la lista entera:
   * recargar perdería la página y el scroll, y el cambio es de una sola fila.
   */
  const aplicar = async (c: Center, restricted: boolean) => {
    const k = keyOf(c);
    setBusyKey(k);
    setError(null);
    try {
      await setCenterRestricted(
        c.companyCode ?? '',
        c.centerCode ?? '',
        restricted,
        restricted ? reason.trim() || null : null,
        c.centerName,
      );
      setRows((prev) =>
        prev.map((r) =>
          keyOf(r) === k
            ? { ...r, restricted, restrictionReason: restricted ? reason.trim() || null : null }
            : r,
        ),
      );
      cerrarConfirmacion();
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo cambiar la restricción del centro'));
    } finally {
      setBusyKey(null);
    }
  };

  const from = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const to = Math.min(pagination.page * pagination.limit, pagination.total);

  return (
    <div className="bo-wh">
      <header className="bo-wh__head">
        <h1 className="bo-wh__title">Centros de distribución</h1>
        <p className="bo-wh__subtitle">
          Centros de tu alcance, ordenados por sociedad. Entrá a un centro para ver sus
          almacenes y reservarlos a clientes o a grupos de clientes. Para dejar un CDI entero
          fuera de circulación —sin reservarlo a nadie— usá Restringir.
        </p>
      </header>

      <div className="bo-wh__toolbar">
        <input
          type="search"
          className="bo-wh__search"
          placeholder="Buscar por centro…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="bo-wh__toolbarhint">
          Hacé click en un centro para ver sus almacenes
        </span>
      </div>

      {error && <p className="bo-wh__error">{error}</p>}

      <div className="bo-wh__tablewrap">
        <table className="bo-wh__table">
          <thead>
            <tr>
              {COLUMNS.map(({ col, label, num, title }) => {
                const activa = sortBy === col;
                return (
                  <th
                    key={col}
                    className={`bo-wh__th--sortable${num ? ' bo-wh__num' : ''}${
                      activa ? ' bo-wh__th--sorted' : ''
                    }`}
                    // aria-sort es lo que hace que un lector de pantalla anuncie por dónde
                    // está ordenada la tabla; la flecha sola no se lee.
                    aria-sort={activa ? (sortDir === 'ASC' ? 'ascending' : 'descending') : 'none'}
                    title={title}
                  >
                    <button
                      type="button"
                      className="bo-wh__sortbtn"
                      onClick={() => ordenarPor(col)}
                    >
                      <span>{label}</span>
                      {activa && <IconSortArrow dir={sortDir} />}
                    </button>
                  </th>
                );
              })}
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {!loading &&
              rows.map((c) => {
                const k = keyOf(c);
                const busy = busyKey === k;
                return (
                  <tr
                    key={k}
                    className={`bo-wh__rowlink${c.restricted ? ' bo-wh__row--restricted' : ''}`}
                    onClick={() => onSelect(c)}
                  >
                    <td>{c.companyCode || '—'}</td>
                    <td>
                      <span className="bo-wh__code">{c.centerCode || '—'}</span>
                      {c.centerName && <span className="bo-wh__sub">{c.centerName}</span>}
                    </td>
                    <td className="bo-wh__num">{c.warehouseCount}</td>
                    <td className="bo-wh__num">
                      {c.restrictedCount > 0 ? (
                        <span className="bo-wh__badge bo-wh__badge--restricted">
                          {c.restrictedCount}
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>
                    {/* El toggle vive DENTRO de una fila clickeable, así que la celda corta
                        la propagación: sin eso, restringir abriría además el drill. */}
                    <td className="bo-wh__statecell" onClick={(e) => e.stopPropagation()}>
                      {confirming === k ? (
                        <div className="bo-wh__confirm">
                          <input
                            className="bo-wh__reasoninput"
                            placeholder="Motivo (opcional)"
                            aria-label="Motivo de la restricción"
                            value={reason}
                            maxLength={512}
                            disabled={busy}
                            autoFocus
                            onChange={(e) => setReason(e.target.value)}
                          />
                          <span className="bo-wh__confirmnote">
                            El centro deja de estar disponible para todos.
                          </span>
                          <span className="bo-wh__confirmbtns">
                            <button
                              type="button"
                              className="bo-wh__dangerbtn"
                              disabled={busy}
                              onClick={() => void aplicar(c, true)}
                            >
                              {busy ? 'Guardando…' : 'Confirmar'}
                            </button>
                            <button
                              type="button"
                              className="bo-wh__ghostbtn"
                              disabled={busy}
                              onClick={cerrarConfirmacion}
                            >
                              Cancelar
                            </button>
                          </span>
                        </div>
                      ) : c.restricted ? (
                        <>
                          <span className="bo-wh__badge bo-wh__badge--restricted">
                            Restringido
                          </span>
                          {c.restrictionReason && (
                            <span className="bo-wh__sub" title={c.restrictionReason}>
                              {c.restrictionReason}
                            </span>
                          )}
                          <button
                            type="button"
                            className="bo-wh__ghostbtn"
                            disabled={busy}
                            onClick={() => void aplicar(c, false)}
                          >
                            {busy ? 'Guardando…' : 'Liberar'}
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="bo-wh__badge bo-wh__badge--available">
                            Disponible
                          </span>
                          <button
                            type="button"
                            className="bo-wh__ghostbtn"
                            disabled={busy}
                            onClick={() => {
                              setReason('');
                              setConfirming(k);
                            }}
                          >
                            Restringir
                          </button>
                        </>
                      )}
                    </td>
                    <td className="bo-wh__chev" aria-label="Ver almacenes">
                      <IconChevronRight />
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>

        {loading && <p className="bo-wh__hint">Cargando…</p>}
        {!loading && !error && rows.length === 0 && (
          <p className="bo-wh__hint">No hay centros para mostrar.</p>
        )}
      </div>

      <footer className="bo-wh__pager">
        <span className="bo-wh__count">
          {pagination.total > 0 ? `${from}–${to} de ${pagination.total}` : 'Sin resultados'}
        </span>
        <div className="bo-wh__pagerbtns">
          <button
            type="button"
            disabled={loading || pagination.page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </button>
          <span className="bo-wh__pageinfo">
            Página {pagination.page} de {Math.max(1, pagination.totalPages)}
          </span>
          <button
            type="button"
            disabled={loading || pagination.page >= pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </button>
        </div>
      </footer>
    </div>
  );
}
