import { CountryManagersResult } from './autorizadores.types';

/**
 * Country Managers de la sociedad.
 *
 * Va aparte de la matriz porque ES OTRA COSA. Autorizar “otra forma de pago” no pasa por
 * `AuthorizerLimits`: lo resuelve el Country Manager. Hay gente que autoriza documentos
 * todos los días sin una sola fila en la matriz, así que una pantalla titulada “quién
 * autoriza” que los omita miente por omisión — y genera justo el ticket que esta sección
 * intenta evitar.
 *
 * No tienen banda ni CEBEs: su permiso no es por descuento ni por centro.
 */
export function CountryManagersPanel({ result }: { result: CountryManagersResult | null }) {
  return (
    <section className="bo-az__cm">
      <h2 className="bo-az__cmtitle">Country Managers</h2>
      <p className="bo-az__cmsub">
        Autorizan el pedido de <strong>otra forma de pago</strong>. Es un permiso distinto: no
        sale de la matriz y no tiene banda de descuento ni CEBEs asignados.
      </p>

      {result === null ? (
        <p className="bo-az__empty">Cargando…</p>
      ) : !result.available ? (
        <p className="bo-az__warn">
          No se pudo consultar los Country Managers de esta sociedad. La lista de abajo no está
          vacía: está <strong>incompleta</strong>, y esta pantalla no puede afirmar quién
          autoriza otra forma de pago hasta que la consulta responda.
        </p>
      ) : result.data.length === 0 ? (
        <p className="bo-az__empty">
          Esta sociedad no tiene ningún Country Manager cargado. Los pedidos de otra forma de
          pago no tienen quién los autorice.
        </p>
      ) : (
        <ul className="bo-az__cmlist">
          {result.data.map((cm) => (
            <li key={cm.email ?? cm.sapUserId ?? cm.name ?? 'sin-identificar'} className="bo-az__cmitem">
              <span className="bo-az__cmname">{cm.name ?? 'Sin nombre'}</span>
              <span className="bo-az__cmmail">{cm.email ?? 'Sin correo'}</span>
              {(cm.role || cm.businessUnit) && (
                <span className="bo-az__cmmeta">
                  {[cm.role, cm.businessUnit].filter(Boolean).join(' · ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
