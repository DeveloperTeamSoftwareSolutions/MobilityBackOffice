import { useEffect, useRef, useState } from 'react';
import { searchCompanies } from './regiones.api';
import { AvailableCompany } from './regiones.types';

/**
 * Typeahead de sociedades del maestro (SAPServices.Companies). Búsqueda debounced;
 * al elegir una, la devuelve al padre para completar el vínculo (CEBE + sociedad).
 */
export function CompanyPicker({
  onPick,
  disabled,
  autoFocus,
}: {
  onPick: (company: AvailableCompany) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AvailableCompany[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    let active = true;
    setLoading(true);
    const t = setTimeout(() => {
      searchCompanies(term)
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

  const pick = (c: AvailableCompany) => {
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
        placeholder="Elegir sociedad: buscar por código o nombre…"
        value={q}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <ul className="bo-rg__pickerlist">
          {loading && <li className="bo-rg__pickerhint">Buscando…</li>}
          {!loading && results.length === 0 && (
            <li className="bo-rg__pickerhint">Sin resultados</li>
          )}
          {results.map((c) => (
            <li key={c.code} className="bo-rg__pickeritem" onClick={() => pick(c)}>
              <span className="bo-rg__code">{c.code}</span>
              <span className="bo-rg__sub">
                {c.name ?? '—'}
                {c.country ? ` · ${c.country}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
