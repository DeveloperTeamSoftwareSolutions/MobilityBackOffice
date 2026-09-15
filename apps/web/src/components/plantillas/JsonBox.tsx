import { useState } from 'react';

/**
 * El JSON, plegado hasta que alguien lo pide.
 *
 * Es lo que WABA muestra en su pantalla y sirve para dos cosas distintas: entender por
 * qué META rechazó algo (el mensaje de META habla de `components[1].parameters`, no de
 * "el botón de abajo"), y poder pegarle el payload exacto a quien integra.
 *
 * Va cerrado por defecto porque para quien arma una plantilla de marketing es ruido.
 */
export function JsonBox({
  titulo,
  valor,
  hint,
  onOpenChange,
  cargando,
  error,
}: {
  titulo: string;
  /** Ya serializado, o `null` si todavía no se pidió. */
  valor: unknown;
  hint?: string;
  /**
   * Se avisa al abrir y al cerrar.
   *
   * Sirve para no pedirle nada al servidor mientras nadie lo mira, y para volver a
   * pedirlo si el formulario cambio: un JSON viejo seria peor que no mostrarlo, porque
   * lo que responde es justamente que se va a enviar.
   */
  onOpenChange?: (abierto: boolean) => void;
  cargando?: boolean;
  error?: string | null;
}) {
  const [abierto, setAbierto] = useState(false);

  const alternar = () => {
    const proximo = !abierto;
    setAbierto(proximo);
    if (onOpenChange) onOpenChange(proximo);
  };

  return (
    <div className="bo-pl__json">
      <button
        type="button"
        className="bo-pl__jsontoggle"
        aria-expanded={abierto}
        onClick={alternar}
      >
        <span className="bo-pl__jsoncaret" aria-hidden="true">
          {abierto ? '▾' : '▸'}
        </span>
        {titulo}
      </button>

      {abierto && (
        <>
          {hint && <p className="bo-pl__hint">{hint}</p>}
          {cargando && <p className="bo-pl__hint">Armando el JSON…</p>}
          {error && <p className="bo-pl__warn">{error}</p>}
          {!cargando && !error && (
            <pre className="bo-pl__jsonbody">
              {valor === null || valor === undefined
                ? 'Todavía no hay nada que mostrar.'
                : JSON.stringify(valor, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
