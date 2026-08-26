import { IconInfo } from '../layout/icons';

interface Props {
  /** El detalle que se muestra al pasar por encima o al enfocar con el teclado. */
  texto: string;
  /** Alinea el globo a la derecha cuando el ícono queda al final de la fila. */
  alineacion?: 'izquierda' | 'derecha';
}

/**
 * Ícono de información con el detalle detrás.
 *
 * Existe para sacar texto de la pantalla sin perderlo: la consola tenía tanta
 * explicación visible que competía con las acciones. Acá el detalle está a un
 * hover de distancia.
 *
 * Es un `<button>` y no un `<span>` a propósito: así se puede enfocar con el
 * teclado y el lector de pantalla lo anuncia. El globo se dibuja con CSS, sin
 * librería de tooltips.
 */
export function InfoTip({ texto, alineacion = 'izquierda' }: Props) {
  return (
    <button
      type="button"
      className={`bo-sp__info bo-sp__info--${alineacion}`}
      data-tip={texto}
      aria-label={texto}
      // No hace nada al hacer clic: el contenido se muestra en hover y en foco.
      onClick={(e) => e.preventDefault()}
    >
      <IconInfo />
    </button>
  );
}
