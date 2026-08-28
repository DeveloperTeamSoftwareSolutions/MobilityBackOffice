import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentTimeline } from './DocumentTimeline';
import { TimelineEvent } from './soporte.types';

/** Tres hitos en orden ascendente, tal como los entrega el middleware. */
const events: TimelineEvent[] = [
  {
    at: '2026-08-26T13:47:31.962Z',
    kind: 'created',
    title: 'Documento creado',
    detail: null,
    actorEmail: 'vendedor@duwest.com',
    actorRole: 'seller',
    source: 'Auditories',
  },
  {
    at: '2026-08-26T13:47:32.322Z',
    kind: 'sent',
    title: 'El vendedor la envió a aprobación',
    detail: null,
    actorEmail: 'vendedor@duwest.com',
    actorRole: 'seller',
    source: 'BusinessOrders.SentAt',
  },
  {
    at: '2026-08-26T13:47:33.172Z',
    kind: 'credit',
    title: 'Crédito aprobado automáticamente',
    detail: null,
    actorEmail: null,
    actorRole: 'credit',
    source: 'CreditEvaluations',
  },
];

/**
 * Fechas de los hitos en el orden en que se ven en pantalla.
 *
 * Se lee el atributo `dateTime` de cada `<time>` y no el texto del título: el título
 * de un hito puede repetirse (la etiqueta del tipo y el título dicen lo mismo, p. ej.
 * "Crédito"), mientras que la fecha es única e identifica al hito sin ambigüedad.
 */
function fechasEnPantalla(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((li) => li.querySelector('time')?.getAttribute('dateTime') ?? '');
}

const PRIMERO = events[0].at;
const ULTIMO = events[events.length - 1].at;

describe('DocumentTimeline — orden de lectura', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('por default muestra los más antiguos primero', () => {
    render(<DocumentTimeline events={events} includeViews={false} />);
    expect(fechasEnPantalla()[0]).toBe(PRIMERO);
  });

  it('al elegir "Más recientes primero" invierte la lista', () => {
    render(<DocumentTimeline events={events} includeViews={false} />);
    fireEvent.click(screen.getByText('Más recientes primero'));
    const fechas = fechasEnPantalla();
    expect(fechas[0]).toBe(ULTIMO);
    expect(fechas[fechas.length - 1]).toBe(PRIMERO);
  });

  it('invertir no pierde ni duplica hitos', () => {
    render(<DocumentTimeline events={events} includeViews={false} />);
    fireEvent.click(screen.getByText('Más recientes primero'));
    expect(screen.getAllByRole('listitem')).toHaveLength(events.length);
  });

  it('se puede volver al orden ascendente', () => {
    render(<DocumentTimeline events={events} includeViews={false} />);
    fireEvent.click(screen.getByText('Más recientes primero'));
    fireEvent.click(screen.getByText('Más antiguos primero'));
    expect(fechasEnPantalla()[0]).toBe(PRIMERO);
  });

  it('recuerda la preferencia entre documentos', () => {
    const { unmount } = render(
      <DocumentTimeline events={events} includeViews={false} />,
    );
    fireEvent.click(screen.getByText('Más recientes primero'));
    unmount();

    render(<DocumentTimeline events={events} includeViews={false} />);
    expect(fechasEnPantalla()[0]).toBe(ULTIMO);
  });

  it('muestra el conteo de hitos', () => {
    render(<DocumentTimeline events={events} includeViews={false} />);
    expect(screen.getByText('3 hitos')).toBeInTheDocument();
  });

  it('sin hitos no dibuja el selector de orden', () => {
    render(<DocumentTimeline events={[]} includeViews={false} />);
    expect(screen.queryByText('Más recientes primero')).toBeNull();
  });
});
