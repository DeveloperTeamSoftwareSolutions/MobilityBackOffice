import { ReactNode, useEffect, useId, useRef } from 'react';
import { Finding } from './consistencia.types';
import {
  RESOLUTION_LABEL,
  SEVERITY_LABEL,
  humanizeRole,
  suggestionSourceLabel,
} from './consistencia.format';
import { FindingActions } from './FindingActions';

interface Props {
  finding: Finding;
  onClose: () => void;
  /** Corrección guardada: el panel avisa, cierra y recarga. */
  onDone: (message: string) => void;
  /** Recarga pedida tras un conflicto: el dato cambió mientras tanto. */
  onReload: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bo-cn__dl-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Con un envío en curso no se cierra: el resultado se perdería a mitad de camino. */
function isBusy(el: HTMLElement | null): boolean {
  return Boolean(el?.querySelector('[aria-busy="true"]'));
}

const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : v;

/**
 * Panel lateral con todo lo que se sabe de un hallazgo y, si se corrige desde acá, sus
 * formularios. Se cierra con Escape y el foco queda atrapado adentro mientras está
 * abierto, como los modales del resto del back-office.
 */
export function FindingDetail({ finding, onClose, onDone, onReload }: Props) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!isBusy(drawerRef.current)) onClose();
        return;
      }
      if (e.key !== 'Tab' || !drawerRef.current) return;
      const items = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  const itManager = finding.resolution === 'ITMANAGER';

  return (
    <div
      className="bo-cn__backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isBusy(drawerRef.current)) onClose();
      }}
    >
      <div
        ref={drawerRef}
        className="bo-cn__drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="bo-cn__drawer-head">
          <div className="bo-cn__drawer-heading">
            <h2 id={titleId} className="bo-cn__drawer-title">
              {finding.label}
            </h2>
            <span className="bo-cn__drawer-meta">
              <span className={`bo-cn__sev bo-cn__sev--${finding.severity}`}>
                <span className="bo-cn__sev-dot" aria-hidden="true" />
                Severidad {SEVERITY_LABEL[finding.severity].toLowerCase()}
              </span>
              <span className={`bo-cn__badge bo-cn__badge--${finding.resolution.toLowerCase()}`}>
                {RESOLUTION_LABEL[finding.resolution]}
              </span>
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="bo-cn__button bo-cn__button--ghost"
            onClick={onClose}
          >
            Cerrar
          </button>
        </header>

        <div className="bo-cn__drawer-body">
          {finding.detail && <p className="bo-cn__detail-text">{finding.detail}</p>}

          <section className="bo-cn__section" aria-label="Persona">
            <h3 className="bo-cn__section-title">Persona</h3>
            <dl className="bo-cn__dl">
              <Item label="Nombre">{dash(finding.personName)}</Item>
              <Item label="Usuario SAP">{dash(finding.sapUserId)}</Item>
              <Item label="Email">{dash(finding.email)}</Item>
              <Item label="Sociedad">{dash(finding.companyCode)}</Item>
              <Item label="Roles en Mobility">
                {finding.roles.length > 0
                  ? finding.roles.map(humanizeRole).join(', ')
                  : 'Sin roles'}
              </Item>
            </dl>
          </section>

          {finding.suggestion && (
            <section className="bo-cn__section" aria-label="Sugerencia">
              <h3 className="bo-cn__section-title">Sugerencia</h3>
              <p className="bo-cn__muted">
                Usuario SAP sugerido: <strong>{finding.suggestion.sapUserId}</strong>:{' '}
                {suggestionSourceLabel(finding.suggestion.source)}.
              </p>
            </section>
          )}

          {finding.members.length > 0 && (
            <section className="bo-cn__section" aria-label="Jerarquía comercial">
              <h3 className="bo-cn__section-title">En la jerarquía comercial</h3>
              <div className="bo-cn__table-wrap">
                <table className="bo-cn__table bo-cn__table--compact">
                  <thead>
                    <tr>
                      <th>Nodo</th>
                      <th>País</th>
                      <th>Rol</th>
                      <th>Nombre</th>
                      <th>Usuario SAP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finding.members.map((m) => (
                      <tr key={m.guid}>
                        <td>{dash(m.nodeName)}</td>
                        <td>{dash(m.nodeCountry)}</td>
                        <td>{dash(m.role)}</td>
                        <td>{dash(m.memberName)}</td>
                        <td>{dash(m.sapUserId)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {finding.portfolios.length > 0 && (
            <section className="bo-cn__section" aria-label="Carteras">
              <h3 className="bo-cn__section-title">Carteras</h3>
              <div className="bo-cn__table-wrap">
                <table className="bo-cn__table bo-cn__table--compact">
                  <thead>
                    <tr>
                      <th>Cartera</th>
                      <th>Sociedad</th>
                      <th>Rol del dueño</th>
                      <th className="bo-cn__th--number">Clientes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finding.portfolios.map((p) => (
                      <tr key={p.guid}>
                        <td>{dash(p.name)}</td>
                        <td>{dash(p.companyCode)}</td>
                        <td>{p.ownerRole ? humanizeRole(p.ownerRole) : '—'}</td>
                        <td className="bo-cn__cell--number">
                          {p.customers === null ? '—' : p.customers.toLocaleString('es-AR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="bo-cn__section" aria-label="Cuenta en SAP">
            <h3 className="bo-cn__section-title">Cuenta en SAP</h3>
            {finding.sapAccount ? (
              <dl className="bo-cn__dl">
                <Item label="Usuario">{finding.sapAccount.userId}</Item>
                <Item label="Nombre">{dash(finding.sapAccount.userName)}</Item>
                <Item label="Estado">{dash(finding.sapAccount.employeeStatus)}</Item>
                <Item label="Email">{dash(finding.sapAccount.email)}</Item>
                <Item label="Puesto">{dash(finding.sapAccount.position)}</Item>
                <Item label="Sociedad">{dash(finding.sapAccount.companyCode)}</Item>
              </dl>
            ) : (
              <p className="bo-cn__muted">No se encontró una cuenta de SAP para esta persona.</p>
            )}
          </section>

          {itManager ? (
            <p className="bo-cn__notice">
              <strong>Esto se resuelve en ITManager.</strong> Los usuarios y sus roles se
              administran allí; cuando se corrija, el hallazgo desaparece en la próxima
              actualización.
            </p>
          ) : (
            <FindingActions finding={finding} onDone={onDone} onReload={onReload} />
          )}
        </div>
      </div>
    </div>
  );
}
