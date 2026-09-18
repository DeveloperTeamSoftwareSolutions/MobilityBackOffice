import { useEffect, useRef, useState } from 'react';
import { searchCustomerGroups } from './warehouses.api';
import { CustomerGroupOption } from './warehouses.types';
import { countLabel, NON_ASSIGNABLE_GROUP_REASON } from './warehouses.format';
import { apiErrorMessage } from '../../api/authApi';

/**
 * Typeahead de grupos de clientes de SAP para reservar un almacén.
 *
 * - Busca en la sociedad del almacén, con debounce de 300 ms. Sin texto trae los grupos más
 *   grandes, así que abrir el buscador ya muestra opciones.
 * - Muestra SIEMPRE código y nombre: hay nombres repetidos con códigos distintos
 *   (`9A` y `9L` se llaman los dos "HAME").
 * - El **grupo 37** aparece deshabilitado y con el motivo a la vista, nunca oculto: así
 *   nadie cree que falta.
 * - Si el entorno tiene un middleware anterior a 1.357.0, la API responde con el motivo y
 *   se muestra dentro de la lista, sin romper el resto de la pantalla.
 */
export function CustomerGroupPicker({
  companyCode,
  onPick,
  disabled,
}: {
  companyCode: string;
  onPick: (customerGroupCode: string) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CustomerGroupOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      searchCustomerGroups(companyCode, q.trim())
        .then((d) => {
          if (active) setResults(d);
        })
        .catch((e) => {
          if (!active) return;
          setResults([]);
          setError(apiErrorMessage(e, 'No se pudieron buscar los grupos'));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q, open, companyCode]);

  // Cerrar al clickear fuera.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (g: CustomerGroupOption) => {
    if (!g.assignable) return;
    onPick(g.customerGroupCode);
    setQ('');
    setOpen(false);
  };

  return (
    <div className="bo-wh__picker" ref={boxRef}>
      <input
        type="search"
        className="bo-wh__pickerinput"
        placeholder="Agregar grupo: buscar por código o nombre…"
        aria-label="Buscar grupo de clientes"
        value={q}
        disabled={disabled}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <ul className="bo-wh__pickerlist">
          {loading && <li className="bo-wh__pickerhint">Buscando…</li>}
          {!loading && error && (
            <li className="bo-wh__pickerhint bo-wh__pickerhint--error">{error}</li>
          )}
          {!loading && !error && results.length === 0 && (
            <li className="bo-wh__pickerhint">Sin grupos con clientes en esta sociedad</li>
          )}
          {!loading &&
            results.map((g) => (
              <li key={g.customerGroupCode}>
                <button
                  type="button"
                  className="bo-wh__pickeritem bo-wh__groupoption"
                  disabled={!g.assignable}
                  onClick={() => pick(g)}
                >
                  <span className="bo-wh__code">{g.customerGroupCode}</span>
                  <span className="bo-wh__sub">{g.customerGroupName || 'Sin nombre'}</span>
                  <span className="bo-wh__groupcount">
                    {countLabel(g.customerCount, 'cliente', 'clientes')}
                  </span>
                  {!g.assignable && (
                    <span className="bo-wh__groupreason">{NON_ASSIGNABLE_GROUP_REASON}</span>
                  )}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
