import { useState } from 'react';
import { RegionList } from './RegionList';
import { RegionDetail } from './RegionDetail';
import { RegionDiagnostics } from './RegionDiagnostics';
import { Region } from './regiones.types';
import './regiones.css';

type Tab = 'regiones' | 'diagnostico';

/**
 * Sección "Regiones comerciales" (solo Administrador). Dos vistas: gestión de regiones
 * (lista → detalle con vínculos CEBE) y diagnóstico de gaps.
 */
export function RegionsPanel() {
  const [tab, setTab] = useState<Tab>('regiones');
  const [selected, setSelected] = useState<Region | null>(null);

  return (
    <div className="bo-rg-shell">
      <div className="bo-rg__tabs">
        <button
          className={`bo-rg__tab ${tab === 'regiones' ? 'bo-rg__tab--active' : ''}`}
          onClick={() => {
            setTab('regiones');
          }}
        >
          Regiones
        </button>
        <button
          className={`bo-rg__tab ${tab === 'diagnostico' ? 'bo-rg__tab--active' : ''}`}
          onClick={() => {
            setTab('diagnostico');
            setSelected(null);
          }}
        >
          Diagnóstico
        </button>
      </div>

      {tab === 'diagnostico' ? (
        <RegionDiagnostics />
      ) : selected ? (
        <RegionDetail region={selected} onBack={() => setSelected(null)} />
      ) : (
        <RegionList onSelect={setSelected} />
      )}
    </div>
  );
}
