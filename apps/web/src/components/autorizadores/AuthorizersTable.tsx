import { Fragment, useState } from 'react';
import { Authorizer, SortableField } from './autorizadores.types';
import {
  bandHint,
  bandLabel,
  formatValidFrom,
  formatValidUntil,
  profitCenterLabel,
  scopeLabel,
} from './autorizadores.format';

const COLUMNS: { key: SortableField; label: string; sortable: boolean }[] = [
  { key: 'userEmail', label: 'Autorizador', sortable: true },
  { key: 'userId', label: 'Usuario SAP', sortable: true },
  { key: 'minimumPercentage', label: 'Banda de firma', sortable: true },
  { key: 'profitCenterCount', label: 'Alcance', sortable: true },
];

/**
 * La matriz, una fila por autorizador.
 *
 * El endpoint devuelve una fila por (autorizador x CEBE); el backend agrupa. Acá cada
 * fila es una persona y sus CEBEs se abren en el detalle, que es como se hace la
 * pregunta "quién está en la matriz".
 *
 * La banda se muestra SIEMPRE interpretada. Los porcentajes crudos de SAP quedan en el
 * detalle, para poder auditar contra SAP sin que la columna mienta.
 */
export function AuthorizersTable({
  rows,
  sortBy,
  sortDir,
  onSort,
}: {
  rows: Authorizer[];
  sortBy: SortableField;
  sortDir: 'ASC' | 'DESC';
  onSort: (field: SortableField) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="bo-az__tablewrap">
      <table className="bo-az__table">
        <thead>
          <tr>
            <th scope="col" className="bo-az__thexpand">
              <span className="bo-az__sr">Detalle</span>
            </th>
            {COLUMNS.map((col) => (
              <th key={col.key} scope="col">
                {col.sortable ? (
                  <button
                    type="button"
                    className="bo-az__sortbtn"
                    onClick={() => onSort(col.key)}
                    aria-sort={
                      sortBy === col.key
                        ? sortDir === 'ASC'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    {col.label}
                    {sortBy === col.key && (
                      <span className="bo-az__sortdir" aria-hidden>
                        {sortDir === 'ASC' ? '▲' : '▼'}
                      </span>
                    )}
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const open = expanded === a.userEmail;
            const hint = bandHint(a.band);
            return (
              <Fragment key={a.userEmail}>
                <tr className={a.band.blocked ? 'bo-az__row--blocked' : undefined}>
                  <td>
                    <button
                      type="button"
                      className="bo-az__expand"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : a.userEmail)}
                    >
                      <span aria-hidden>{open ? '−' : '+'}</span>
                      <span className="bo-az__sr">
                        {open ? 'Ocultar' : 'Ver'} detalle de {a.userEmail}
                      </span>
                    </button>
                  </td>
                  <td className="bo-az__email">{a.userEmail}</td>
                  <td>{a.userId ?? '—'}</td>
                  <td>
                    <span
                      className={`bo-az__band${a.band.blocked ? ' bo-az__band--blocked' : ''}`}
                    >
                      {bandLabel(a.band)}
                    </span>
                    {hint && <span className="bo-az__bandhint">{hint}</span>}
                  </td>
                  <td>
                    <span
                      className={
                        a.coversWholeCompany ? 'bo-az__scope bo-az__scope--all' : 'bo-az__scope'
                      }
                    >
                      {scopeLabel(a.coversWholeCompany, a.profitCenters, a.activeProfitCenterCount)}
                    </span>
                  </td>
                </tr>
                {open && (
                  <tr className="bo-az__detailrow">
                    <td colSpan={COLUMNS.length + 1}>
                      <div className="bo-az__detail">
                        <div className="bo-az__detailblock">
                          <h4 className="bo-az__detailtitle">Límites cargados en SAP</h4>
                          <p className="bo-az__raw">
                            MinimumPercentage: <code>{a.minimumPercentage ?? 'null'}</code> ·
                            MaximumPercentage: <code>{a.maximumPercentage ?? 'null'}</code>
                          </p>
                          <p className="bo-az__rawhint">
                            Son los valores crudos. Un valor de 100 o más significa “sin límite”
                            en ese extremo, y un 0/0 significa que la matriz no está configurada.
                          </p>
                        </div>

                        <div className="bo-az__detailblock">
                          <h4 className="bo-az__detailtitle">Centros de beneficio</h4>
                          {a.coversWholeCompany ? (
                            <p className="bo-az__rawhint">
                              Firma en toda la sociedad: no tiene restricción por CEBE.
                            </p>
                          ) : a.profitCenters.length === 0 ? (
                            <p className="bo-az__rawhint">Sin asignaciones de CEBE.</p>
                          ) : (
                            <ul className="bo-az__cebelist">
                              {a.profitCenters.map((pc) => (
                                <li
                                  key={pc.code}
                                  className={pc.active ? 'bo-az__cebe' : 'bo-az__cebe bo-az__cebe--off'}
                                >
                                  <span className="bo-az__cebecode">{profitCenterLabel(pc)}</span>
                                  <span className="bo-az__cebedates">
                                    {formatValidFrom(pc.validFrom)} → {formatValidUntil(pc.validUntil)}
                                    {!pc.active && ' · fuera de vigencia'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
