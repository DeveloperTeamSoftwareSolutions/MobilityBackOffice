import { useCallback, useEffect, useState } from 'react';
import {
  addReservedCustomer,
  addReservedGroup,
  getReservedCustomers,
  getReservedGroups,
  removeReservedCustomer,
  removeReservedGroup,
} from './warehouses.api';
import { CustomerPicker } from './CustomerPicker';
import { CustomerGroupPicker } from './CustomerGroupPicker';
import { GroupCustomersList } from './GroupCustomersList';
import { ReservedCustomer, ReservedCustomerGroup, Warehouse } from './warehouses.types';
import { countLabel, removalFreesWarehouse } from './warehouses.format';
import { apiErrorMessage } from '../../api/authApi';
import { IconCaret } from '../layout/icons';

interface ListState<T> {
  loading: boolean;
  error: string | null;
  data: T[];
}
const loadingList = <T,>(): ListState<T> => ({ loading: true, error: null, data: [] });

type ReserveMode = 'customer' | 'group';
type PendingRemoval = { kind: ReserveMode; code: string; label: string };

/**
 * Reservas de un almacén: clientes con nombre y apellido y grupos de clientes de SAP, en
 * una sola lista.
 *
 * La restricción es CONSECUENCIA de las reservas: la primera —cliente o grupo— restringe el
 * almacén y quitar la última lo libera. Por eso quitar la última pide confirmación.
 *
 * Clientes y grupos se cargan por separado a propósito: si el entorno todavía no tiene la
 * reserva por grupo (middleware anterior a 1.357.0), los clientes siguen funcionando y el
 * bloque de grupos muestra el motivo en vez de tumbar la pantalla.
 */
export function WarehouseReservations({
  warehouse,
  onChanged,
}: {
  warehouse: Warehouse;
  /** Algo cambió: la lista de almacenes tiene que recargar estado y contadores. */
  onChanged: () => void;
}) {
  const cc = warehouse.companyCode ?? '';
  const ce = warehouse.centerCode ?? '';
  const wc = warehouse.warehouseCode ?? '';

  const [customers, setCustomers] = useState<ListState<ReservedCustomer>>(loadingList);
  const [groups, setGroups] = useState<ListState<ReservedCustomerGroup>>(loadingList);
  const [mode, setMode] = useState<ReserveMode>('customer');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCustomers = useCallback(() => {
    setCustomers(loadingList());
    getReservedCustomers(cc, ce, wc)
      .then((data) => setCustomers({ loading: false, error: null, data }))
      .catch((e) =>
        setCustomers({
          loading: false,
          error: apiErrorMessage(e, 'No se pudieron cargar los clientes'),
          data: [],
        }),
      );
  }, [cc, ce, wc]);

  const loadGroups = useCallback(() => {
    setGroups(loadingList());
    getReservedGroups(cc, ce, wc)
      .then((data) => setGroups({ loading: false, error: null, data }))
      .catch((e) =>
        setGroups({
          loading: false,
          error: apiErrorMessage(e, 'No se pudieron cargar los grupos'),
          data: [],
        }),
      );
  }, [cc, ce, wc]);

  useEffect(() => {
    loadCustomers();
    loadGroups();
  }, [loadCustomers, loadGroups]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      loadCustomers();
      loadGroups();
      onChanged();
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo guardar el cambio'));
    } finally {
      setBusy(false);
    }
  };

  const remove = (r: PendingRemoval) =>
    run(async () => {
      setPending(null);
      if (r.kind === 'customer') await removeReservedCustomer(cc, ce, wc, r.code);
      else await removeReservedGroup(cc, ce, wc, r.code);
      if (r.kind === 'group' && expandedGroup === r.code) setExpandedGroup(null);
    });

  /** Quitar: si es la última reserva, primero se confirma. */
  const requestRemoval = (r: PendingRemoval) => {
    // Si una de las listas no cargó, se usa el contador que trajo la lista de almacenes:
    // ante la duda, confirmar.
    const groupCount = groups.error ? warehouse.groupCount : groups.data.length;
    const customerCount = customers.error ? warehouse.customerCount : customers.data.length;
    if (removalFreesWarehouse(customerCount, groupCount)) setPending(r);
    else void remove(r);
  };

  const listsLoading = customers.loading || groups.loading;
  const nothingReserved =
    !listsLoading && customers.data.length === 0 && groups.data.length === 0;

  return (
    <div className="bo-wh__reservations">
      {error && <p className="bo-wh__error">{error}</p>}

      {pending && (
        <div className="bo-wh__confirm" role="alert">
          <span className="bo-wh__confirmnote">
            Vas a quitar {pending.label}. Este almacén queda disponible para todos los
            clientes.
          </span>
          <span className="bo-wh__confirmbtns">
            <button
              type="button"
              className="bo-wh__dangerbtn"
              disabled={busy}
              onClick={() => void remove(pending)}
            >
              {busy ? 'Guardando…' : 'Confirmar'}
            </button>
            <button
              type="button"
              className="bo-wh__ghostbtn"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancelar
            </button>
          </span>
        </div>
      )}

      {listsLoading && <p className="bo-wh__drillhint">Cargando reservas…</p>}
      {nothingReserved && !customers.error && !groups.error && (
        <p className="bo-wh__drillhint">
          {warehouse.restricted
            ? 'Sin reservas todavía.'
            : 'Asigná el primer cliente o grupo para reservar este almacén.'}
        </p>
      )}

      {/* Grupos de clientes de SAP */}
      {!groups.loading && groups.error && (
        <p className="bo-wh__drillhint">Grupos de clientes: {groups.error}</p>
      )}
      {!groups.loading && groups.data.length > 0 && (
        <ul className="bo-wh__groups" aria-label="Grupos reservados">
          {groups.data.map((g) => {
            const open = expandedGroup === g.customerGroupCode;
            return (
              <li key={g.guid || g.customerGroupCode} className="bo-wh__grouprow">
                <div className="bo-wh__groupline">
                  <button
                    type="button"
                    className="bo-wh__groupbtn"
                    aria-expanded={open}
                    onClick={() => setExpandedGroup(open ? null : g.customerGroupCode)}
                  >
                    <IconCaret open={open} />
                    <span className="bo-wh__groupname">
                      Grupo {g.customerGroupCode} — {g.customerGroupName || 'Sin nombre'}
                    </span>
                    <span className="bo-wh__groupcount">
                      {countLabel(g.customerCount, 'cliente', 'clientes')}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="bo-wh__dangerbtn"
                    disabled={busy}
                    aria-label={`Quitar grupo ${g.customerGroupCode}`}
                    onClick={() =>
                      requestRemoval({
                        kind: 'group',
                        code: g.customerGroupCode,
                        label: `el grupo ${g.customerGroupCode}`,
                      })
                    }
                  >
                    Quitar
                  </button>
                </div>
                {open && (
                  <GroupCustomersList
                    companyCode={cc}
                    customerGroupCode={g.customerGroupCode}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Clientes */}
      {!customers.loading && customers.error && (
        <p className="bo-wh__drillhint">Clientes: {customers.error}</p>
      )}
      {!customers.loading && customers.data.length > 0 && (
        <ul className="bo-wh__customers" aria-label="Clientes reservados">
          {customers.data.map((c, i) => (
            <li key={c.guidCustomers ?? `${c.customerCode}-${i}`}>
              <span className="bo-wh__custinfo">
                <span className="bo-wh__code">{c.customerCode || '—'}</span>
                {c.customerName && <span className="bo-wh__sub">{c.customerName}</span>}
              </span>
              <button
                type="button"
                className="bo-wh__dangerbtn"
                disabled={busy}
                aria-label={`Quitar cliente ${c.customerCode ?? ''}`}
                onClick={() =>
                  requestRemoval({
                    kind: 'customer',
                    code: c.customerCode ?? '',
                    label: `el cliente ${c.customerCode ?? ''}`,
                  })
                }
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Reservar: a un cliente o a un grupo */}
      <div className="bo-wh__reservemode" role="group" aria-label="Reservar a">
        <span className="bo-wh__reservelabel">Reservar a:</span>
        <button
          type="button"
          className="bo-wh__modebtn"
          aria-pressed={mode === 'customer'}
          onClick={() => setMode('customer')}
        >
          Cliente
        </button>
        <button
          type="button"
          className="bo-wh__modebtn"
          aria-pressed={mode === 'group'}
          onClick={() => setMode('group')}
        >
          Grupo de clientes
        </button>
      </div>
      {mode === 'customer' ? (
        <CustomerPicker
          disabled={busy}
          onPick={(code) => void run(() => addReservedCustomer(cc, ce, wc, code))}
        />
      ) : (
        <CustomerGroupPicker
          companyCode={cc}
          disabled={busy}
          onPick={(code) => void run(() => addReservedGroup(cc, ce, wc, code))}
        />
      )}
    </div>
  );
}
