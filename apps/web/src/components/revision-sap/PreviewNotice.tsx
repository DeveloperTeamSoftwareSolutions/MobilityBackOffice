/**
 * Lo que la sección todavía no hace. Mientras el reenvío no esté conectado, nadie
 * tiene que creer que corregir la orden alcanza para que llegue a SAP.
 */
export function PreviewNotice() {
  return (
    <p className="bo-rs__preview" role="note">
      <strong>El reenvío a SAP todavía no está conectado.</strong> Por ahora podés revisar
      la orden y corregir el destino de entrega de cada ítem. El centro por ítem queda
      pendiente: hoy SAP recibe solo el de la cabecera.
    </p>
  );
}
