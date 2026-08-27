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

/**
 * Qué decir cuando la lista viene vacía.
 *
 * El endpoint devuelve 200 con lista vacía por tres causas distintas y **solo una es un
 * hecho del negocio**. Las otras dos son problemas de carga, y presentarlas como “nadie
 * autoriza otra forma de pago” sería afirmar algo falso con toda seguridad. El backend
 * las separa consultando el árbol de la jerarquía; acá cada una dice qué mirar.
 */
function EmptyState({ diagnosis }: { diagnosis: CountryManagersResult['diagnosis'] }) {
  if (diagnosis === 'sin_nodo') {
    return (
      <p className="bo-az__warn">
        No se encontró ningún nodo <strong>Country Manager</strong> en la jerarquía comercial.
        La consulta los identifica por el <strong>nombre del nodo</strong>, así que esto
        también pasa si lo renombraron. <strong>No significa que nadie autorice</strong> otra
        forma de pago: significa que desde acá no se puede saber quién.
      </p>
    );
  }

  if (diagnosis === 'sin_miembros') {
    return (
      <p className="bo-az__warn">
        La jerarquía tiene un nodo <strong>Country Manager</strong>, pero ninguno de sus
        integrantes resuelve a esta sociedad. Puede ser que no tenga uno asignado, o que al
        integrante le falte la ficha de usuario con su sociedad SAP cargada.
      </p>
    );
  }

  // 'ok' con data vacía no debería ocurrir; se trata como el caso conservador.
  return (
    <p className="bo-az__empty">
      No se encontró ningún Country Manager para esta sociedad. Los pedidos de otra forma de
      pago no tendrían quién los autorice.
    </p>
  );
}

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
        <EmptyState diagnosis={result.diagnosis} />
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
