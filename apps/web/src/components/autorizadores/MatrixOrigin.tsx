/**
 * De dónde sale cada dato de la matriz.
 *
 * Va en pantalla, y no solo en `docs/`, porque es la pregunta que la sección genera
 * apenas alguien la usa: “¿por qué figura esta persona acá?”. Sin la respuesta al lado
 * del dato, esa pregunta termina en un ticket o en una consulta a la base — que es
 * exactamente lo que la sección vino a evitar.
 */
export function MatrixOrigin() {
  return (
    <details className="bo-az__origin">
      <summary className="bo-az__originsum">¿De dónde sale esta información?</summary>
      <table className="bo-az__origintable">
        <tbody>
          <tr>
            <th scope="row">Que la persona autorice</th>
            <td>
              <code>SAPServices.AuthorizerLimits</code> — replicada de SAP. Tener una fila acá
              es lo que la pone en la matriz.
            </td>
          </tr>
          <tr>
            <th scope="row">La banda de firma</th>
            <td>
              <code>MinimumPercentage</code> / <code>MaximumPercentage</code> de esa misma
              tabla. Se muestran <strong>interpretados</strong>: leídos literal mienten (un
              0/0 significa “no puede firmar”, un 200 significa “sin límite”). Los valores
              crudos están en el detalle de cada fila.
            </td>
          </tr>
          <tr>
            <th scope="row">Los CEBEs</th>
            <td>
              <code>SAPServices.AuthorizerProfitCenters</code>, unida por correo. El nombre
              del CEBE sale del maestro <code>VIEW_V2_ProfitCentersMobility</code>.
            </td>
          </tr>
          <tr>
            <th scope="row">La sociedad</th>
            <td>
              <code>AuthorizerLimits.CompanyCode</code>. Los CEBEs, en cambio, se asignan por
              persona y <strong>sin</strong> sociedad.
            </td>
          </tr>
        </tbody>
      </table>
      <p className="bo-az__originnote">
        Es de <strong>solo lectura</strong>: SAP sincroniza estas tablas y una fila cargada a
        mano la pisa la próxima sincronización. Para cambiar la matriz hay que pedirlo a SAP.
      </p>
    </details>
  );
}
