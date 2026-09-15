import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditPolicyNotice } from './EditPolicyNotice';
import { EditPolicy } from './plantillas.types';

function policy(over: Partial<EditPolicy> = {}): EditPolicy {
  return {
    canEdit: true,
    reason: null,
    requiresMeta: true,
    limited: false,
    used: 0,
    remaining: null,
    cooldownUntil: null,
    warnings: [],
    ...over,
  };
}

/**
 * Las reglas son de META y las evalúa WABA; acá sólo se muestran. Lo que importa es que
 * se digan **antes** de escribir: enterarse al guardar significa haber completado un
 * formulario para nada.
 */
describe('EditPolicyNotice', () => {
  afterEach(() => vi.useRealTimers());

  it('sin política no dibuja nada', () => {
    const { container } = render(<EditPolicyNotice policy={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('cuando no se puede editar, dice por qué', () => {
    render(
      <EditPolicyNotice
        policy={policy({ canEdit: false, reason: 'META está revisando esta plantilla.' })}
      />,
    );
    expect(screen.getByText(/Todavía no se puede editar/)).toBeInTheDocument();
    expect(screen.getByText(/META está revisando esta plantilla/)).toBeInTheDocument();
  });

  it('sin motivo, igual explica algo', () => {
    // Un bloqueo sin explicación es peor que el bloqueo.
    render(<EditPolicyNotice policy={policy({ canEdit: false, reason: null })} />);
    expect(screen.getByText(/no permite editar esta plantilla/)).toBeInTheDocument();
  });

  it('si se puede editar y no hay nada que avisar, no ocupa lugar', () => {
    const { container } = render(<EditPolicyNotice policy={policy()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('muestra los avisos que no bloquean', () => {
    render(
      <EditPolicyNotice
        policy={policy({ warnings: ['Al guardar, la plantilla vuelve a revisión de META.'] })}
      />,
    );
    expect(screen.getByText(/vuelve a revisión de META/)).toBeInTheDocument();
  });

  it('muestra el cupo de ediciones y aclara que es orientativo', () => {
    // El número sale de un conteo propio: alguien que edite desde el Business Manager de
    // Meta lo deja desactualizado, y presentarlo como exacto seria mentir.
    render(<EditPolicyNotice policy={policy({ limited: true, used: 7, remaining: 3 })} />);

    expect(screen.getByText(/Ediciones restantes: 3/)).toBeInTheDocument();
    expect(screen.getByText(/usaste 7/)).toBeInTheDocument();
    expect(screen.getByText(/orientativo/)).toBeInTheDocument();
  });

  it('la espera se dice en horas, no en fecha ISO', () => {
    // Quien está por editar necesita saber cuánto falta, no un timestamp.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));

    render(
      <EditPolicyNotice
        policy={policy({
          limited: true,
          remaining: 9,
          cooldownUntil: '2026-09-01T05:00:00.000Z',
        })}
      />,
    );

    expect(screen.getByText(/en 5 horas/)).toBeInTheDocument();
    expect(screen.queryByText(/2026-09-01T05/)).toBeNull();
  });

  it('una espera ya vencida no se muestra', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <EditPolicyNotice
        policy={policy({
          limited: true,
          remaining: 9,
          cooldownUntil: '2026-09-01T05:00:00.000Z',
        })}
      />,
    );

    expect(screen.queryByText(/se puede volver a editar/)).toBeNull();
  });

  it('una fecha rota no rompe el aviso', () => {
    render(
      <EditPolicyNotice
        policy={policy({ limited: true, remaining: 9, cooldownUntil: 'no-es-una-fecha' })}
      />,
    );
    expect(screen.getByText(/Ediciones restantes: 9/)).toBeInTheDocument();
  });
});
