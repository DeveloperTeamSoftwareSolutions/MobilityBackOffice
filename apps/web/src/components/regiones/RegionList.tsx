import { useEffect, useState } from 'react';
import { getRegions, getGroups } from './regiones.api';
import { apiErrorMessage } from '../../api/authApi';
import { Region } from './regiones.types';

/**
 * Lista de regiones comerciales: las atómicas (catálogo `Continents`: CA/CB/AN/NA) más
 * las agrupaciones virtuales (CAYCAR). El catálogo es fijo (pocas filas), así que se
 * traen juntas; el buscador filtra por código/nombre.
 */
export function RegionList({ onSelect }: { onSelect: (r: Region) => void }) {
  const [rows, setRows] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([getRegions('', 1, 200), getGroups()])
      .then(([paged, groups]) => {
        if (!active) return;
        setRows([...paged.data, ...groups]);
      })
      .catch((e) => active && setError(apiErrorMessage(e, 'Error inesperado')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const term = search.trim().toLowerCase();
  const visible = term
    ? rows.filter(
        (r) => r.code.toLowerCase().includes(term) || r.name.toLowerCase().includes(term),
      )
    : rows;

  return (
    <div className="bo-rg">
      <header className="bo-rg__head">
        <h1 className="bo-rg__title">Regiones comerciales</h1>
        <p className="bo-rg__subtitle">
          Asociá CEBEs (Centros de Beneficio) a cada región para consolidar los reportes por
          CEBE. CAYCAR agrupa Centroamérica y Caribe.
        </p>
      </header>

      <div className="bo-rg__toolbar">
        <input
          type="search"
          className="bo-rg__search"
          placeholder="Buscar región…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <p className="bo-rg__error">{error}</p>}

      <div className="bo-rg__tablewrap">
        <table className="bo-rg__table">
          <thead>
            <tr>
              <th>Región</th>
              <th>Tipo</th>
              <th className="bo-rg__num">CEBEs</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!loading &&
              visible.map((r) => (
                <tr key={r.guid} className="bo-rg__rowlink" onClick={() => onSelect(r)}>
                  <td>
                    <span className="bo-rg__code">{r.code}</span>
                    <span className="bo-rg__sub">{r.name}</span>
                  </td>
                  <td>
                    <span
                      className={`bo-rg__badge bo-rg__badge--${r.isGroup ? 'group' : 'region'}`}
                    >
                      {r.isGroup ? 'Agrupación' : 'Región'}
                    </span>
                  </td>
                  <td className="bo-rg__num">{r.cebeCount}</td>
                  <td className="bo-rg__chev">›</td>
                </tr>
              ))}
          </tbody>
        </table>
        {loading && <p className="bo-rg__hint">Cargando…</p>}
        {!loading && visible.length === 0 && <p className="bo-rg__hint">No hay regiones.</p>}
      </div>
    </div>
  );
}

