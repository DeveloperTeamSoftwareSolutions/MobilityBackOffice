/** Placeholder para secciones ya declaradas en la navegación pero aún sin construir. */
export function ComingSoon({
  titulo,
  descripcion,
}: {
  titulo: string;
  descripcion: string;
}) {
  return (
    <>
      <h1 className="bo-page__title">{titulo}</h1>
      <p className="bo-page__subtitle">{descripcion}</p>
      <div className="bo-card">
        <p style={{ margin: 0, color: 'var(--bo-text-muted)' }}>
          Esta sección todavía no está disponible.
        </p>
      </div>
    </>
  );
}
