import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlantillasPanel } from './PlantillasPanel';
import { httpClient } from '../../api/httpClient';
import { EditPolicy, Template } from './plantillas.types';

function plantilla(over: Partial<Template> = {}): Template {
  return {
    id: 7,
    name: 'promo_navidad',
    language: 'es_MX',
    category: 'MARKETING',
    status: 'APPROVED',
    headerType: 'NONE',
    headerContent: null,
    bodyText: 'Hola, te esperamos.',
    footerText: null,
    buttons: [],
    variables: [],
    ...over,
  };
}

function politica(over: Partial<EditPolicy> = {}): EditPolicy {
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
 * Intercepta el cliente HTTP con las respuestas que necesita la pantalla para arrancar.
 * Se recorre el camino real: `plantillas.api` arma las URLs y lee las respuestas.
 */
function interceptar(templates: Template[], policy: EditPolicy = politica()) {
  const get = vi.spyOn(httpClient, 'get').mockImplementation((url: string) => {
    if (url === '/api/templates/status') {
      return Promise.resolve({ data: { success: true, configured: true } }) as never;
    }
    if (url === '/api/templates') {
      return Promise.resolve({
        data: {
          success: true,
          data: templates,
          pagination: { total: templates.length, page: 1, limit: 25, totalPages: 1 },
          summary: {},
          onlyApproved: false,
        },
      }) as never;
    }
    // Detalle: /api/templates/:id
    const id = Number(url.split('/').pop());
    const t = templates.find((x) => x.id === id) ?? templates[0];
    return Promise.resolve({
      data: { success: true, template: t, editPolicy: policy },
    }) as never;
  });

  const post = vi
    .spyOn(httpClient, 'post')
    .mockResolvedValue({ data: { success: true, data: plantilla() } } as never);
  const put = vi
    .spyOn(httpClient, 'put')
    .mockResolvedValue({ data: { success: true, data: plantilla() } } as never);

  return { get, post, put };
}

/** Abre la edición de la fila y llega al último paso del asistente. */
async function editarYLlegarAlFinal(nombre: string) {
  // La lista llega por HTTP: hay que esperarla antes de buscar la fila.
  const fila = (await screen.findByText(nombre)).closest('tr') as HTMLElement;
  await userEvent.click(within(fila).getByRole('button', { name: 'Editar' }));

  const revision = await screen.findByRole('button', { name: /\d\s*Revisión/ });
  await userEvent.click(revision);
}

/**
 * Enviar un borrador y editar una plantilla de META son operaciones distintas en WABA, y
 * confundirlas falla en silencio: un `PUT` sobre un borrador lo guarda local, lo deja en
 * `DRAFT`, y la pantalla dice "enviada a revisión" sin que a META haya llegado nada.
 */
describe('PlantillasPanel — a dónde va cada guardado', () => {
  afterEach(() => vi.restoreAllMocks());

  it('un borrador se envía por el endpoint que lo manda a META', async () => {
    const { post } = interceptar(
      [plantilla({ id: 62, name: 'borrador_de_prueba', status: 'DRAFT' })],
      politica({ requiresMeta: false }),
    );
    render(<PlantillasPanel />);

    await editarYLlegarAlFinal('borrador_de_prueba');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar a revisión' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/templates/drafts/62/submit',
        expect.anything(),
      ),
    );
  });

  it('una plantilla que ya está en META se edita con PUT', async () => {
    const { put } = interceptar([plantilla({ id: 7, status: 'APPROVED' })]);
    render(<PlantillasPanel />);

    await editarYLlegarAlFinal('promo_navidad');
    await userEvent.click(
      screen.getByRole('button', { name: 'Guardar y reenviar a revisión' }),
    );

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][0]).toBe('/api/templates/7');
  });

  it('al editar no viajan el nombre ni el idioma', async () => {
    // META los toma como identidad de la plantilla: mandarlos es un rechazo seguro.
    const { put } = interceptar([plantilla({ id: 7, status: 'APPROVED' })]);
    render(<PlantillasPanel />);

    await editarYLlegarAlFinal('promo_navidad');
    await userEvent.click(
      screen.getByRole('button', { name: 'Guardar y reenviar a revisión' }),
    );

    await waitFor(() => expect(put).toHaveBeenCalled());
    const enviado = put.mock.calls[0][1] as Record<string, unknown>;
    expect(enviado).not.toHaveProperty('name');
    expect(enviado).not.toHaveProperty('language');
  });
});

describe('PlantillasPanel — lo que META no deja editar', () => {
  afterEach(() => vi.restoreAllMocks());

  it('una plantilla en revisión tiene el botón Editar apagado', async () => {
    interceptar([plantilla({ id: 54, name: 'en_revision', status: 'PENDING' })]);
    render(<PlantillasPanel />);

    const fila = (await screen.findByText('en_revision')).closest('tr') as HTMLElement;
    const editar = within(fila).getByRole('button', { name: 'Editar' });

    expect(editar).toBeDisabled();
    expect(editar).toHaveAttribute('title', expect.stringContaining('revisando'));
  });

  it('si la política lo bloquea, no se abre el formulario', async () => {
    // Puede pasar aunque el estado parezca editable: el cupo o un id de META faltante.
    interceptar(
      [plantilla({ id: 7, status: 'APPROVED' })],
      politica({ canEdit: false, reason: 'META tiene una revisión en curso.' }),
    );
    render(<PlantillasPanel />);

    const fila = (await screen.findByText('promo_navidad')).closest('tr') as HTMLElement;
    await userEvent.click(within(fila).getByRole('button', { name: 'Editar' }));

    expect(await screen.findByText(/META tiene una revisión en curso/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revisión/ })).toBeNull();
  });
});
