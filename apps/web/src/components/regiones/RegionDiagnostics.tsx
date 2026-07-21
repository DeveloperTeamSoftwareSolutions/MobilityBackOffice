import { useEffect, useState } from 'react';
import { getUnmapped, getMultiRegion } from './regiones.api';
import { apiErrorMessage } from '../../api/authApi';
import { AvailableCebe, MultiRegionCebe } from './regiones.types';

/**
 * Diagnóstico de calidad del mapeo (para deslindar responsabilidad cuando un reporte da mal):
 *  - CEBEs sin región: existen en el maestro pero no están vinculados (no cargados).
 *  - CEBEs en varias regiones: posible solapamiento a revisar.
 */
export function RegionDiagnostics() {
  const [unmapped, setUnmapped] = useState<AvailableCebe[]>([]);
  const [multi, setMulti] = useState<MultiRegionCebe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([getUnmapped(), getMultiRegion()])
      .then(([u, m]) => {
        if (!active) return;
        setUnmapped(u);
        setMulti(m);
      })
      .catch((e) => active && setError(apiErrorMessage(e, 'Error inesperado')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="bo-rg">
      <header className="bo-rg__head">
        <h1 className="bo-rg__title">Diagnóstico del mapeo</h1>
        <p className="bo-rg__subtitle">
          Si un reporte regional da mal, revisá acá si un CEBE quedó sin cargar o está en más de
          una región.
        </p>
      </header>

      {error && <p className="bo-rg__error">{error}</p>}
      {loading && <p className="bo-rg__hint">Cargando…</p>}

      {!loading && (
        <div className="bo-rg__diaggrid">
          <section className="bo-rg__diagcard">
            <h2 className="bo-rg__diagtitle">
              CEBEs sin región
              <span className="bo-rg__badge bo-rg__badge--warn">{unmapped.length}</span>
            </h2>
            <p className="bo-rg__diaghint">Están en el maestro pero no se vincularon a ninguna región.</p>
            <div className="bo-rg__tablewrap">
              <table className="bo-rg__table">
                <thead>
                  <tr>
                    <th>CEBE</th>
                    <th>Nombre</th>
                  </tr>
                </thead>
                <tbody>
                  {unmapped.map((c) => (
                    <tr key={c.code}>
                      <td>
                        <span className="bo-rg__code">{c.code}</span>
                      </td>
                      <td>{c.name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {unmapped.length === 0 && <p className="bo-rg__hint">Todos los CEBEs tienen región.</p>}
            </div>
          </section>

          <section className="bo-rg__diagcard">
            <h2 className="bo-rg__diagtitle">
              CEBEs en varias regiones
              <span className="bo-rg__badge bo-rg__badge--warn">{multi.length}</span>
            </h2>
            <p className="bo-rg__diaghint">Vinculados a más de una región (revisar si es correcto).</p>
            <div className="bo-rg__tablewrap">
              <table className="bo-rg__table">
                <thead>
                  <tr>
                    <th>CEBE</th>
                    <th>Regiones</th>
                  </tr>
                </thead>
                <tbody>
                  {multi.map((c) => (
                    <tr key={c.code}>
                      <td>
                        <span className="bo-rg__code">{c.code}</span>
                        <span className="bo-rg__sub">{c.name ?? '—'}</span>
                      </td>
                      <td>{c.regions.map((r) => r.code).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {multi.length === 0 && <p className="bo-rg__hint">Ningún CEBE está en varias regiones.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

