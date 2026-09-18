import { useEffect, useRef, useState } from 'react';
import { searchCustomers } from './warehouses.api';
import { ReservedCustomer } from './warehouses.types';

/**
 * Typeahead de clientes: busca por código o nombre con debounce de 300 ms y devuelve el
 * código elegido. Mismo patrón que `CebePicker` de Regiones (no hay typeahead compartido
 * en BackOffice: cada sección arma el suyo).
 */
export function CustomerPicker({
  onPick,
  disabled,
}: {
  onPick: (customerCode: string) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ReservedCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    setLoading(true);
    const t = setTimeout(() => {
      searchCustomers(term)
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

  // Cerrar al clickear fuera.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (c: ReservedCustomer) => {
    if (!c.customerCode) return;
    onPick(c.customerCode);
    setQ('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="bo-wh__picker" ref={boxRef}>
      <input
        type="search"
        className="bo-wh__pickerinput"
        placeholder="Agregar cliente: buscar por código o nombre…"
        aria-label="Buscar cliente"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open && (
        <ul className="bo-wh__pickerlist">
          {loading && <li className="bo-wh__pickerhint">Buscando…</li>}
          {!loading && results.length === 0 && (
            <li className="bo-wh__pickerhint">Sin resultados</li>
          )}
          {!loading &&
            results.map((c, i) => (
              <li key={c.guidCustomers ?? `${c.customerCode}-${i}`}>
                <button
                  type="button"
                  className="bo-wh__pickeritem"
                  onClick={() => pick(c)}
                >
                  <span className="bo-wh__code">{c.customerCode}</span>
                  {c.customerName && <span className="bo-wh__sub">{c.customerName}</span>}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
