import { useCallback, useEffect, useState } from 'react';
import { CebePicker } from './CebePicker';
import { CompanyPicker } from './CompanyPicker';
import { getRegion, resolveRegion, linkCebe, unlinkCebe } from './regiones.api';
import { apiErrorMessage } from '../../api/authApi';
import { Region, RegionCebe, AvailableCebe, AvailableCompany } from './regiones.types';

/**
 * Detalle de una región. Si es **atómica** (CA/CB/AN/NA): lista sus vínculos
 * CEBE↔sociedad, permite agregar (en dos pasos: elegir CEBE, luego sociedad) y quitar.
 * Si es **agrupación** (CAYCAR): muestra en solo lectura los pares efectivos (unión de
 * sus miembros) — no se edita.
 */
export function RegionDetail({ region, onBack }: { region: Region; onBack: () => void }) {
  const [cebes, setCebes] = useState<RegionCebe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Paso 1 del alta: CEBE elegido, a la espera de la sociedad (paso 2).
  const [pendingCebe, setPendingCebe] = useState<AvailableCebe | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const p = region.isGroup
      ? resolveRegion(region.code)
      : getRegion(region.guid).then((d) => d.cebes);
    p.then(setCebes)
      .catch((e) => setError(apiErrorMessage(e, 'Error inesperado')))
      .finally(() => setLoading(false));
  }, [region]);

  useEffect(() => {
    load();
  }, [load]);

  const onAddCompany = (company: AvailableCompany) => {
    if (!pendingCebe) return;
    setBusy(true);
    setError(null);
    linkCebe(region.guid, pendingCebe.code, company.code, pendingCebe.name)
      .then(() => {
        setPendingCebe(null);
        load();
      })
      .catch((e) => setError(apiErrorMessage(e, 'Error inesperado')))
      .finally(() => setBusy(false));
  };

  const onRemove = (code: string, companyCode: string) => {
    setBusy(true);
    setError(null);
    unlinkCebe(region.guid, code, companyCode)
      .then(load)
      .catch((e) => setError(apiErrorMessage(e, 'Error inesperado')))
      .finally(() => setBusy(false));
  };

  return (
    <div className="bo-rg">
      <header className="bo-rg__head">
        <button className="bo-rg__back" onClick={onBack}>
          ← Regiones
        </button>
        <h1 className="bo-rg__title">
          {region.name}
          <span className={`bo-rg__badge bo-rg__badge--${region.isGroup ? 'group' : 'region'}`}>
            {region.isGroup ? 'Agrupación' : 'Región'}
          </span>
        </h1>
        <span className="bo-rg__code">{region.code}</span>
      </header>

      {region.isGroup && (
        <p className="bo-rg__note">
          Agrupación: los CEBEs se resuelven por unión de sus regiones. Solo lectura.
        </p>
      )}

      {error && <p className="bo-rg__error">{error}</p>}

      <div className="bo-rg__tablewrap">
        <table className="bo-rg__table">
          <thead>
            <tr>
              <th>CEBE</th>
              <th>Nombre</th>
              <th>Sociedad</th>
              {!region.isGroup && <th />}
            </tr>
          </thead>
          <tbody>
            {!loading &&
              cebes.map((c) => (
                <tr key={`${c.profitCenterCode}|${c.companyCode}`}>
                  <td>
                    <span className="bo-rg__code">{c.profitCenterCode}</span>
                  </td>
                  <td>{c.profitCenterName ?? '—'}</td>
                  <td>
                    <span className="bo-rg__code">{c.companyCode}</span>
                    <span className="bo-rg__sub">{c.companyName ?? '—'}</span>
                  </td>
                  {!region.isGroup && (
                    <td className="bo-rg__actioncell">
                      <button
                        className="bo-rg__removebtn"
                        disabled={busy}
                        onClick={() => onRemove(c.profitCenterCode, c.companyCode)}
                      >
                        Quitar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
        {loading && <p className="bo-rg__hint">Cargando…</p>}
        {!loading && cebes.length === 0 && (
          <p className="bo-rg__hint">
            {region.isGroup
              ? 'Sin CEBEs en las regiones que agrupa.'
              : 'Sin CEBEs vinculados.'}
          </p>
        )}
      </div>

      {!region.isGroup && (
        <div className="bo-rg__add">
          {!pendingCebe ? (
            <CebePicker disabled={busy} onPick={setPendingCebe} />
          ) : (
            <div className="bo-rg__addstep2">
              <span className="bo-rg__pending">
                CEBE <span className="bo-rg__code">{pendingCebe.code}</span>
                <span className="bo-rg__sub">{pendingCebe.name ?? '—'}</span>
              </span>
              <CompanyPicker disabled={busy} autoFocus onPick={onAddCompany} />
              <button
                className="bo-rg__cancelbtn"
                disabled={busy}
                onClick={() => setPendingCebe(null)}
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

