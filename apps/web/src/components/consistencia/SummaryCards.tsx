import { Severity } from './consistencia.types';
import { SEVERITY_LABEL } from './consistencia.format';

export interface SummaryCardItem {
  key: string;
  label: string;
  count: number;
  severity?: Severity;
  badge?: string;
  /** Texto secundario debajo del conteo (por ejemplo, clientes y vendedores). */
  sub?: string;
}

interface Props {
  items: SummaryCardItem[];
  selected: string | null;
  /** Etiqueta accesible del grupo de tarjetas. */
  ariaLabel: string;
  onToggle: (key: string) => void;
}

/**
 * Tarjetas de resumen que además filtran: un clic filtra por esa situación y otro clic
 * sobre la misma quita el filtro. `aria-pressed` es lo que anuncia el estado a un
 * lector de pantalla.
 */
export function SummaryCards({ items, selected, ariaLabel, onToggle }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="bo-cn__cards" role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = selected === item.key;
        const classes = [
          'bo-cn__card',
          item.severity ? `bo-cn__card--${item.severity}` : 'bo-cn__card--neutral',
          active ? 'bo-cn__card--active' : '',
          item.count === 0 ? 'bo-cn__card--empty' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={item.key}
            type="button"
            className={classes}
            aria-pressed={active}
            onClick={() => onToggle(item.key)}
          >
            <span className="bo-cn__card-count">{item.count.toLocaleString('es-AR')}</span>
            <span className="bo-cn__card-label">{item.label}</span>
            {item.sub && <span className="bo-cn__card-sub">{item.sub}</span>}
            {(item.severity || item.badge) && (
              <span className="bo-cn__card-meta">
                {item.severity && (
                  <span className={`bo-cn__sev bo-cn__sev--${item.severity}`}>
                    <span className="bo-cn__sev-dot" aria-hidden="true" />
                    {SEVERITY_LABEL[item.severity]}
                  </span>
                )}
                {item.badge && <span className="bo-cn__badge">{item.badge}</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
