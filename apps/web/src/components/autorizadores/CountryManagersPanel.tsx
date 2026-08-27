import { CountryManagerNode, CountryManagersResult } from './autorizadores.types';

/**
 * Integrantes de los nodos “COUNTRY MANAGER” de la jerarquía comercial.
 *
 * NO se titula “Country Managers” a secas, y es a propósito. El nodo es un **puesto del
 * organigrama**, no una persona: sus integrantes son el equipo que cuelga de ahí. En
 * QATEST, el nodo “COUNTRY MANAGER BAN” tiene tres integrantes y dos son
 * `Role: "Vendedor"` — reportan al country manager, no lo son.
 *
 * La app **no filtra por rol ni adivina** quién ocupa el puesto: Duwest no publica un
 * flag que lo diga. Muestra el rol de cada uno, dice de qué tabla sale cada dato, y deja
 * la lectura a quien mira. Presentar a un vendedor como “Country Manager” sería
 * exactamente la afirmación falsa que esta sección intenta eliminar.
 *
 * Importa igual porque autorizar “otra forma de pago” no pasa por `AuthorizerLimits`:
 * lo resuelve el country manager, así que hay gente que autoriza sin una sola fila en la
 * matriz.
 */

/** De dónde sale cada dato. Va en pantalla porque es la pregunta que genera los tickets. */
function Procedencia() {
  return (
    <details className="bo-az__origin">
      <summary className="bo-az__originsum">¿De dónde sale esta información?</summary>
      <table className="bo-az__origintable">
        <tbody>
          <tr>
            <th scope="row">Que la persona esté acá</th>
            <td>
              <code>CommercialTeamHierarchies.Name</code> — el nodo cuyo nombre empieza con
              “COUNTRY MANAGER”. Es el <strong>nombre del nodo</strong>, no de la persona.
            </td>
          </tr>
          <tr>
            <th scope="row">El rol (Vendedor, Gerente…)</th>
            <td>
              <code>CommercialTeamMembers.Role</code> — texto libre cargado por Duwest.{' '}
              <strong>No se usa para filtrar</strong>: por eso podés ver a un vendedor en
              esta lista.
            </td>
          </tr>
          <tr>
            <th scope="row">Nombre y correo</th>
            <td>
              <code>Users</code>, por <code>GuidUsers</code>.
            </td>
          </tr>
          <tr>
            <th scope="row">La sociedad</th>
            <td>
              <code>Users.SapCompanyCode</code> — la sociedad <strong>de la persona</strong>,
              no la del nodo.
            </td>
          </tr>
        </tbody>
      </table>
      <p className="bo-az__originnote">
        Estar en este nodo <strong>no significa ser country manager</strong>: significa
        pertenecer a ese equipo del organigrama. Quién ocupa el puesto se distingue por el
        rol, y ese dato lo carga Duwest.
      </p>
    </details>
  );
}

/**
 * Qué decir cuando no vino nadie.
 *
 * El endpoint responde 200 con lista vacía por tres causas y **solo una es un hecho del
 * negocio**. Las otras dos son problemas de carga; presentarlas como “nadie autoriza”
 * sería afirmar algo falso.
 */
function EmptyState({ diagnosis }: { diagnosis: CountryManagersResult['diagnosis'] }) {
  if (diagnosis === 'sin_nodo') {
    return (
      <p className="bo-az__warn">
        No se encontró ningún nodo <strong>“COUNTRY MANAGER”</strong> en la jerarquía
        comercial. Se los identifica por el <strong>nombre del nodo</strong>, así que esto
        también pasa si lo renombraron. <strong>No significa que nadie autorice</strong>:
        significa que desde acá no se puede saber quién.
      </p>
    );
  }

  if (diagnosis === 'sin_miembros') {
    return (
      <p className="bo-az__warn">
        La jerarquía tiene un nodo <strong>“COUNTRY MANAGER”</strong>, pero ninguno de sus
        integrantes pertenece a esta sociedad. Puede ser que no tenga a nadie asignado, o
        que a la persona le falte la ficha de usuario con su sociedad SAP cargada.
      </p>
    );
  }

  return (
    <p className="bo-az__empty">
      No se encontró ningún integrante para esta sociedad.
    </p>
  );
}

function NodeBlock({ node }: { node: CountryManagerNode }) {
  return (
    <div className="bo-az__cmnode">
      <h3 className="bo-az__cmnodename">
        {node.nodeName ?? 'Nodo sin nombre'}
        {node.country && <span className="bo-az__cmnodecountry">{node.country}</span>}
      </h3>

      <ul className="bo-az__cmlist">
        {node.members.map((m) => (
          <li
            key={m.sapUserId ?? m.email ?? m.name ?? 'sin-identificar'}
            className={m.inCompany ? 'bo-az__cmitem' : 'bo-az__cmitem bo-az__cmitem--other'}
          >
            <span className="bo-az__cmtop">
              <span className="bo-az__cmname">{m.name ?? 'Sin nombre'}</span>
              {/* El rol es el dato que evita leer a un vendedor como country manager. */}
              <span className="bo-az__cmrole">{m.role ?? 'Sin rol cargado'}</span>
            </span>

            <span className="bo-az__cmmail">
              {m.email ?? (m.inCompany ? 'Sin correo' : 'Correo no disponible acá')}
            </span>

            <span className="bo-az__cmmeta">
              {m.sapUserId ? `Usuario SAP ${m.sapUserId}` : 'Sin usuario SAP'}
              {m.inCompany
                ? m.companyCode
                  ? ` · sociedad ${m.companyCode}`
                  : ''
                : ' · pertenece a otra sociedad'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CountryManagersPanel({ result }: { result: CountryManagersResult | null }) {
  const hasMembers = result?.nodes.some((n) => n.members.length > 0) ?? false;

  return (
    <section className="bo-az__cm">
      <h2 className="bo-az__cmtitle">Jerarquía comercial — nodos “Country Manager”</h2>
      <p className="bo-az__cmsub">
        Autorizar <strong>otra forma de pago</strong> no pasa por la matriz: lo resuelve el
        country manager. Acá están los <strong>integrantes</strong> de esos nodos, con el rol
        que tiene cargado cada uno.
      </p>

      {result === null ? (
        <p className="bo-az__empty">Cargando…</p>
      ) : !result.available ? (
        <p className="bo-az__warn">
          No se pudo consultar la jerarquía comercial de esta sociedad. La lista de abajo no
          está vacía: está <strong>incompleta</strong>.
        </p>
      ) : !hasMembers ? (
        <EmptyState diagnosis={result.diagnosis} />
      ) : (
        <>
          <p className="bo-az__cmcaveat">
            Un nodo llamado “COUNTRY MANAGER” es un <strong>puesto del organigrama</strong>, y
            su equipo cuelga de ahí. Estar en la lista <strong>no significa</strong> ser
            country manager — mirá el rol de cada uno.
          </p>

          {result.nodes.map((node) => (
            <NodeBlock key={node.nodeGuid ?? node.nodeName ?? 'nodo'} node={node} />
          ))}
        </>
      )}

      <Procedencia />
    </section>
  );
}
