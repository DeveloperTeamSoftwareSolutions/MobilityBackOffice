import { useEffect, useRef, useState } from 'react';
import { searchCebes } from './regiones.api';
import { AvailableCebe } from './regiones.types';

/**
 * Typeahead de CEBEs del maestro (VIEW_V2_ProfitCentersMobility). Búsqueda debounced;
 * al elegir uno, lo devuelve al padre para vincularlo a la región.
 */
export function CebePicker({
  onPick,
  disabled,
}: {
  onPick: (cebe: AvailableCebe) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AvailableCebe[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) {
      setResults([]);
      return;
    }
    let active = true;
    setLoading(true);
    const t = setTimeout(() => {
      searchCebes(term)
        .then((d) => {
          if (!active) return;
          setResults(d);
          setOpen(true);
        })
        .catch(() => active && setResults([]))
        .finally(() => active && setLoading(false));
    }, 300);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (c: AvailableCebe) => {
    onPick(c);
    setQ('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="bo-rg__picker" ref={boxRef}>
      <input
        type="search"
        className="bo-rg__pickerinput"
        placeholder="Vincular CEBE: buscar por código o nombre…"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open && (
        <ul className="bo-rg__pickerlist">
          {loading && <li className="bo-rg__pickerhint">Buscando…</li>}
          {!loading && results.length === 0 && (
            <li className="bo-rg__pickerhint">Sin resultados</li>
          )}
          {results.map((c) => (
            <li
              key={c.code}
              className="bo-rg__pickeritem"
              onClick={() => pick(c)}
            >
              <span className="bo-rg__code">{c.code}</span>
              <span className="bo-rg__sub">{c.name ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
