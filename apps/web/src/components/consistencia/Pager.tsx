import { Pagination } from './consistencia.types';

interface Props {
  pagination: Pagination;
  loading: boolean;
  /** Sustantivo en plural para el total: "hallazgos", "clientes". */
  noun: string;
  onPage: (page: number) => void;
}

/** Paginador server-side: sólo pide otra página, no recorta nada en memoria. */
export function Pager({ pagination, loading, noun, onPage }: Props) {
  const page = pagination.page || 1;
  const totalPages = Math.max(1, pagination.totalPages || 1);
  return (
    <div className="bo-cn__pager">
      <span className="bo-cn__pager-info">
        {pagination.total.toLocaleString('es-AR')} {noun} · página {page} de {totalPages}
      </span>
      <div className="bo-cn__pager-buttons">
        <button
          type="button"
          className="bo-cn__button bo-cn__button--ghost"
          disabled={page <= 1 || loading}
          onClick={() => onPage(page - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className="bo-cn__button bo-cn__button--ghost"
          disabled={page >= totalPages || loading}
          onClick={() => onPage(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
