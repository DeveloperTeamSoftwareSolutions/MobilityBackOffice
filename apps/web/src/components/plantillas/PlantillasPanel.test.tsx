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
    createdAt: null,
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

/**
 * Reabrir un borrador tiene que devolverlo donde quedó.
 *
 * El detalle de la plantilla no alcanza: no trae el título, ni el archivo del encabezado,
 * ni el ejemplo de cada variable —solo los números—. Y META **exige** los ejemplos, así
 * que perderlos convierte "seguir mañana" en "escribir todo de nuevo".
 */
describe('PlantillasPanel — reabrir un borrador', () => {
  afterEach(() => vi.restoreAllMocks());

  const borrador = {
    id: 62,
    name: 'promo_navidad',
    language: 'es_MX',
    category: 'MARKETING',
    headerType: 'IMAGE',
    headerContent: null,
    headerHandle: '4::aW1h:abc123',
    bodyText: 'Hola {{1}}, te esperamos el {{2}}.',
    footerText: 'Duwest',
    buttons: [],
    createdAt: null,
    variables: [
      { index: 1, target: 'body' as const, label: 'nombre', example: 'María' },
      { index: 2, target: 'body' as const, label: 'fecha', example: '12 de marzo' },
    ],
    friendlyTitle: 'Promo de navidad',
    otpType: 'COPY_CODE',
    codeExpirationMinutes: null,
    addSecurityRecommendation: false,
  };

  /** Como `interceptar`, pero respondiendo también el endpoint del borrador. */
  function interceptarConBorrador(draft: unknown = borrador) {
    const plantillaDraft = plantilla({
      id: 62,
      name: 'promo_navidad',
      status: 'DRAFT',
      headerType: 'IMAGE',
      bodyText: 'Hola {{1}}, te esperamos el {{2}}.',
      // El detalle solo trae los números: es justamente lo que no alcanza.
      variables: ['1', '2'],
    });

    const get = vi.spyOn(httpClient, 'get').mockImplementation((url: string) => {
      if (url === '/api/templates/status') {
        return Promise.resolve({ data: { success: true, configured: true } }) as never;
      }
      if (url === '/api/templates') {
        return Promise.resolve({
          data: {
            success: true,
            data: [plantillaDraft],
            pagination: { total: 1, page: 1, limit: 25, totalPages: 1 },
            summary: {},
            onlyApproved: false,
          },
        }) as never;
      }
      if (url === '/api/templates/drafts/62') {
        if (draft === null) return Promise.reject(new Error('no anda')) as never;
        return Promise.resolve({ data: { success: true, data: draft } }) as never;
      }
      return Promise.resolve({
        data: { success: true, template: plantillaDraft, editPolicy: politica({ requiresMeta: false }) },
      }) as never;
    });

    return { get };
  }

  async function abrirBorrador() {
    const fila = (await screen.findByText('promo_navidad')).closest('tr') as HTMLElement;
    await userEvent.click(within(fila).getByRole('button', { name: 'Editar' }));
  }

  it('pide el borrador, no solo el detalle', async () => {
    const { get } = interceptarConBorrador();
    render(<PlantillasPanel />);

    await abrirBorrador();

    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/api/templates/drafts/62'),
    );
  });

  it('vuelve con el título que se le había puesto', async () => {
    interceptarConBorrador();
    render(<PlantillasPanel />);

    await abrirBorrador();
    // El título vive en el paso "Nombre".
    await userEvent.click(await screen.findByRole('button', { name: /\d\s*Nombre/ }));

    expect(screen.getByDisplayValue('Promo de navidad')).toBeInTheDocument();
  });

  it('vuelve con los ejemplos de las variables', async () => {
    // Lo más caro de perder: META los exige, y son lo único que hay que reescribir a mano.
    interceptarConBorrador();
    render(<PlantillasPanel />);

    await abrirBorrador();
    await userEvent.click(await screen.findByRole('button', { name: /\d\s*Mensaje/ }));

    expect(screen.getByDisplayValue('María')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12 de marzo')).toBeInTheDocument();
    expect(screen.getByDisplayValue('nombre')).toBeInTheDocument();
  });

  it('vuelve con el archivo del encabezado ya subido', async () => {
    interceptarConBorrador();
    render(<PlantillasPanel />);

    await abrirBorrador();
    await userEvent.click(await screen.findByRole('button', { name: /\d\s*Extras/ }));

    expect(screen.getByText('Archivo ya subido a META')).toBeInTheDocument();
  });

  it('una plantilla que no es borrador no pide el borrador', async () => {
    const { get } = interceptar([plantilla({ id: 7, status: 'APPROVED' })]);
    render(<PlantillasPanel />);

    const fila = (await screen.findByText('promo_navidad')).closest('tr') as HTMLElement;
    await userEvent.click(within(fila).getByRole('button', { name: 'Editar' }));

    await screen.findByRole('button', { name: /\d\s*Revisión/ });
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining('/drafts/'));
  });

  it('si el borrador no se puede traer, se abre igual y avisa', async () => {
    // Quedarse sin poder abrirlo sería peor que abrirlo incompleto.
    interceptarConBorrador(null);
    render(<PlantillasPanel />);

    await abrirBorrador();

    expect(
      await screen.findByText(/No se pudo recuperar todo el borrador/),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /\d\s*Mensaje/ })).toBeInTheDocument();
  });
});

/**
 * "WABA no está configurado" y "el API no contesta" se arreglan de formas muy distintas:
 * uno mandando a revisar un `.env`, el otro levantando un proceso. Antes se veían igual,
 * y eso mandó a revisar un archivo que estaba bien.
 */
describe('PlantillasPanel — configurado vs caído', () => {
  afterEach(() => vi.restoreAllMocks());

  it('si WABA no está configurado, lo dice y nombra las variables', async () => {
    vi.spyOn(httpClient, 'get').mockResolvedValue({
      data: { success: true, configured: false },
    } as never);
    render(<PlantillasPanel />);

    expect(await screen.findByText(/no está configurada/)).toBeInTheDocument();
    expect(screen.getByText('WABA_API_URL')).toBeInTheDocument();
  });

  it('si el API no responde, NO dice que falte configurar', async () => {
    // Es el error que confundió: cualquier fallo caía en "falta configurar".
    vi.spyOn(httpClient, 'get').mockRejectedValue(new Error('Network Error'));
    render(<PlantillasPanel />);

    expect(await screen.findByText(/El servidor no responde/)).toBeInTheDocument();
    expect(screen.queryByText(/no está configurada/)).toBeNull();
  });

  it('mientras carga no acusa a nadie', async () => {
    // Un aviso que parpadea antes de saber la respuesta es peor que ninguno.
    vi.spyOn(httpClient, 'get').mockReturnValue(new Promise(() => {}) as never);
    const { container } = render(<PlantillasPanel />);

    expect(container.querySelector('.bo-pl__warn')).toBeNull();
  });
});

/**
 * Guardar un borrador crea la plantilla del lado del servidor, pero la lista solo se
 * refrescaba al **enviar**. El borrador quedaba creado y no aparecía en pantalla — que
 * desde afuera se lee como "no se guardó".
 */
describe('PlantillasPanel — la lista después de guardar un borrador', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cerrar el editor vuelve a pedir la lista', async () => {
    const { get } = interceptar([plantilla()]);
    render(<PlantillasPanel />);
    await screen.findByText('promo_navidad');

    const pedidosAntes = get.mock.calls.filter((c) => c[0] === '/api/templates').length;

    await userEvent.click(screen.getByRole('button', { name: 'Nueva plantilla' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => {
      const pedidosDespues = get.mock.calls.filter((c) => c[0] === '/api/templates').length;
      expect(pedidosDespues).toBeGreaterThan(pedidosAntes);
    });
  });

  it('el borrador guardado aparece al cerrar', async () => {
    // La prueba de fuego: se guarda uno y tiene que estar en la lista sin recargar la página.
    const conBorrador = plantilla({ id: 71, name: 'recien_guardado', status: 'DRAFT' });
    let primeraVuelta = true;

    vi.spyOn(httpClient, 'get').mockImplementation((url: string) => {
      if (url === '/api/templates/status') {
        return Promise.resolve({ data: { success: true, configured: true } }) as never;
      }
      if (url === '/api/templates') {
        // La segunda vez ya existe: es lo que devolvería el servidor tras guardarlo.
        const data = primeraVuelta ? [] : [conBorrador];
        primeraVuelta = false;
        return Promise.resolve({
          data: {
            success: true,
            data,
            pagination: { total: data.length, page: 1, limit: 25, totalPages: 1 },
            summary: {},
            onlyApproved: false,
          },
        }) as never;
      }
      return Promise.resolve({ data: { success: true } }) as never;
    });
    vi.spyOn(httpClient, 'post').mockResolvedValue({
      data: { success: true, draftId: 71 },
    } as never);

    render(<PlantillasPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Nueva plantilla' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText(/No se envió nada a META/);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(await screen.findByText('recien_guardado')).toBeInTheDocument();
  });
});

describe('PlantillasPanel — el orden de la lista', () => {
  afterEach(() => vi.restoreAllMocks());

  it('arranca por fecha de creación, lo más nuevo primero', async () => {
    // En una lista que crece, lo último que se hizo es lo que se viene a buscar.
    const { get } = interceptar([plantilla()]);
    render(<PlantillasPanel />);
    await screen.findByText('promo_navidad');

    const params = get.mock.calls.find((c) => c[0] === '/api/templates')?.[1] as {
      params: { sortBy: string; sortDir: string };
    };
    expect(params.params.sortBy).toBe('createdAt');
    expect(params.params.sortDir).toBe('DESC');
  });

  it('muestra la fecha, porque es el criterio del orden', async () => {
    // Una lista ordenada por algo que no se ve parece desordenada.
    interceptar([plantilla({ createdAt: '2026-08-30T10:00:00Z' })]);
    render(<PlantillasPanel />);

    await screen.findByText('promo_navidad');
    expect(screen.getByRole('button', { name: /Creada/ })).toBeInTheDocument();
    expect(screen.getByText('30/08/2026')).toBeInTheDocument();
  });

  it('una plantilla sin fecha muestra un guion, no una fecha inventada', async () => {
    interceptar([plantilla({ createdAt: null })]);
    render(<PlantillasPanel />);

    await screen.findByText('promo_navidad');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('al ordenar por nombre arranca alfabético, no al revés', async () => {
    // Por fecha se quiere lo más nuevo; por texto, la A primero.
    const { get } = interceptar([plantilla()]);
    render(<PlantillasPanel />);
    await screen.findByText('promo_navidad');

    await userEvent.click(screen.getByRole('button', { name: /Nombre/ }));

    await waitFor(() => {
      const ultima = get.mock.calls.filter((c) => c[0] === '/api/templates').pop() as [
        string,
        { params: { sortBy: string; sortDir: string } },
      ];
      expect(ultima[1].params.sortBy).toBe('name');
      expect(ultima[1].params.sortDir).toBe('ASC');
    });
  });
});
