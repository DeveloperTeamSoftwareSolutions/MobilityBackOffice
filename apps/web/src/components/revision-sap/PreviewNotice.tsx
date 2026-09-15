/**
 * Aviso de vista previa. Mientras la sección muestre datos de ejemplo, nadie tiene
 * que confundir estas órdenes con órdenes reales.
 */
export function PreviewNotice() {
  return (
    <p className="bo-rs__preview" role="note">
      <strong>Vista previa con datos de ejemplo.</strong> Las órdenes no son reales y
      el reenvío a SAP todavía no está conectado.
    </p>
  );
}
