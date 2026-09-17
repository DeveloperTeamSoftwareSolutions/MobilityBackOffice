/**
 * Lo que la sección todavía no hace. Mientras el reenvío no esté conectado, nadie
 * tiene que creer que corregir la orden alcanza para que llegue a SAP.
 */
export function PreviewNotice() {
  return (
    <p className="bo-rs__preview" role="note">
      <strong>El reenvío a SAP todavía no está conectado.</strong> Podés revisar la orden y
      corregir el centro y el destino de cada ítem. Cuando el reenvío parta la orden por
      centro, cada centro va a salir como una orden SAP.
    </p>
  );
}
