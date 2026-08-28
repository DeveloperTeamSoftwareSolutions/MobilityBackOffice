import { useEffect, useRef, useState } from 'react';
import { searchCompanies } from './autorizadores.api';
import { AvailableCompany } from './autorizadores.types';

/**
 * Selector de sociedad de la matriz.
 *
 * Existe porque el endpoint del middleware EXIGE `companyCode`: no hay forma de pedir la
 * matriz completa de un saque. La sociedad es además el eje por el que se razona el
 * alcance, así que elegirla primero no es una limitación sino el orden natural.
 *
 * Es un typeahead y no un `<select>` porque el maestro lo sirve el middleware con
 * búsqueda por código o nombre; cargarlo entero al montar sería una llamada de más para
 * una lista que igual se filtra escribiendo.
 */
export function CompanySelect({
  selected,
  onPick,
  disabled,
}: {
  selected: AvailableCompany | null;
  onPick: (company: AvailableCompany) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AvailableCompany[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    let active = true;
    setLoading(true);
    const t = setTimeout(() => {
      searchCompanies(term)
        .then((d) => {
          if (!active) return;
          setResults(d);
          setFailed(false);
        })
        .catch(() => {
          if (!active) return;
          setResults([]);
          setFailed(true);
        })
        .finally(() => active && setLoading(false));
    }, 300);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q, open]);

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
    setOpen(false);
  };

  return (
    <div className="bo-az__picker" ref={boxRef}>
      <label className="bo-az__pickerlabel" htmlFor="bo-az-company">
        Sociedad
      </label>
      <input
        id="bo-az-company"
        type="search"
        className="bo-az__pickerinput"
        placeholder={
          selected ? `${selected.code} · ${selected.name ?? 'Sin nombre'}` : 'Buscar por código o nombre…'
        }
        value={q}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <ul className="bo-az__pickerlist">
          {loading && <li className="bo-az__pickerhint">Buscando…</li>}
          {!loading && failed && (
            <li className="bo-az__pickerhint">No se pudo consultar el maestro de sociedades</li>
          )}
          {!loading && !failed && results.length === 0 && (
            <li className="bo-az__pickerhint">Sin resultados</li>
          )}
          {!loading &&
            results.map((c) => (
              <li key={c.code}>
                <button type="button" className="bo-az__pickeritem" onClick={() => pick(c)}>
                  <span className="bo-az__code">{c.code}</span>
                  <span className="bo-az__sub">
                    {c.name ?? 'Sin nombre'}
                    {c.country ? ` · ${c.country}` : ''}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
