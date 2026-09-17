import { parseSapError, sapErrorTypeLabel } from './revision-sap.logic';

interface Props {
  error: string | null;
  /** Texto cuando SAP no dejó motivo. */
  emptyText?: string;
}

/**
 * El motivo del rechazo, tal como lo manda SAP: tipo y mensaje.
 *
 * El Middleware arma cada línea como `[E] texto` y une varias con ` | `. Mostrarlo así
 * crudo obliga a leer entre corchetes; separado, se ve de un vistazo qué hay que
 * corregir (`E`) y qué es solo un aviso (`W`).
 */
export function SapErrorMessage({ error, emptyText = 'SAP no devolvió un motivo.' }: Props) {
  const lines = parseSapError(error);
  if (lines.length === 0) return <p className="bo-rs__sap-message">{emptyText}</p>;

  return (
    <ul className="bo-rs__sap-lines">
      {lines.map((line, i) => (
        <li key={`${line.type ?? '-'}-${i}`} className="bo-rs__sap-line">
          {line.type && (
            <span
              className={`bo-rs__sap-type bo-rs__sap-type--${line.type === 'E' || line.type === 'A' ? 'error' : line.type === 'W' ? 'warn' : 'info'}`}
              title={`Tipo ${line.type} de SAP`}
            >
              {sapErrorTypeLabel(line.type)}
            </span>
          )}
          <span className="bo-rs__sap-text">{line.message}</span>
        </li>
      ))}
    </ul>
  );
}
