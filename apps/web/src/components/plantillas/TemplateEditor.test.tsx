import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateEditor } from './TemplateEditor';
import { httpClient } from '../../api/httpClient';
import { Template } from './plantillas.types';

/** Se intercepta el cliente HTTP: así el test recorre el `saveDraft` real. */
function interceptarBorrador(draftId: number | null = 60) {
  return vi
    .spyOn(httpClient, 'post')
    .mockResolvedValue({ data: { success: true, draftId } } as never);
}

/** Una plantilla que ya existe en META. */
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

function montar(over: Partial<Parameters<typeof TemplateEditor>[0]> = {}) {
  return render(
    <TemplateEditor
      template={null}
      editPolicy={null}
      draft={null}
      onCancel={vi.fn()}
      onSubmit={vi.fn()}
      saving={false}
      serverErrors={[]}
      {...over}
    />,
  );
}

/**
 * El estado vive en el contenedor, así que alternar de modo no pierde nada. Además se
 * guarda un borrador al alternar —como hace WABA—, porque el estado en memoria se pierde
 * si se cierra la pestaña y el borrador sobrevive.
 */
describe('TemplateEditor', () => {
  afterEach(() => vi.restoreAllMocks());

  it('el alta arranca en el asistente', () => {
    montar();
    expect(screen.getByText('Crear plantilla con asistente')).toBeInTheDocument();
  });

  it('editar también arranca en el asistente', () => {
    // Crear y editar arrancan igual. Lo que cambia es que el nombre y el idioma quedan
    // bloqueados: META los toma como identidad de la plantilla.
    montar({
      template: plantilla(),
    });
    expect(screen.getByText('Editar promo_navidad con asistente')).toBeInTheDocument();
  });

  it('guarda un borrador al pasar al modo avanzado', async () => {
    const post = interceptarBorrador();
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'Modo avanzado' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe('/api/templates/drafts');
    expect(screen.getByText('Nueva plantilla — modo avanzado')).toBeInTheDocument();
  });

  it('el segundo guardado actualiza el mismo borrador en vez de crear otro', async () => {
    // Sin reusar el id, cada ida y vuelta entre modos dejaría un borrador huérfano.
    const post = interceptarBorrador(60);
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'Modo avanzado' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: 'Volver al asistente' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));

    expect((post.mock.calls[0][1] as { draftId: number | null }).draftId).toBeNull();
    expect((post.mock.calls[1][1] as { draftId: number | null }).draftId).toBe(60);
  });

  it('si el borrador falla igual se cambia de modo', async () => {
    // Perder el modo por un error de red sería peor que quedarse sin borrador: los datos
    // siguen en pantalla.
    vi.spyOn(httpClient, 'post').mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('Request failed'), {
          response: { data: { message: 'WABA no responde' } },
        }),
      ),
    );
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'Modo avanzado' }));

    await waitFor(() =>
      expect(screen.getByText('Nueva plantilla — modo avanzado')).toBeInTheDocument(),
    );
  });

  it('en edición no se ofrece guardar borrador', async () => {
    // Lo que ya existe en META no es un borrador.
    montar({
      template: plantilla(),
    });
    expect(screen.queryByRole('button', { name: 'Guardar borrador' })).toBeNull();
  });

  it('el botón de borrador avisa que no se envió nada a META', async () => {
    interceptarBorrador();
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));

    await waitFor(() =>
      expect(screen.getByText(/No se envió nada a META/)).toBeInTheDocument(),
    );
  });
  it('al editar, el nombre y el idioma quedan bloqueados', async () => {
    // META los toma como identidad de la plantilla: cambiarlos no es editar, es crear otra.
    montar({ template: plantilla() });

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(screen.getByLabelText(/Nombre técnico/)).toBeDisabled();
    expect(screen.getByLabelText('Idioma')).toBeDisabled();
    expect(screen.getAllByText(/no se pueden cambiar/).length).toBeGreaterThan(0);
  });

  it('al editar se puede pasar al modo avanzado y volver', async () => {
    interceptarBorrador();
    montar({ template: plantilla() });

    await userEvent.click(screen.getByRole('button', { name: 'Modo avanzado' }));
    expect(screen.getByText('Editar promo_navidad')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Volver al asistente' }));
    expect(screen.getByText('Editar promo_navidad con asistente')).toBeInTheDocument();
  });

  it('editar no crea borradores', async () => {
    // Lo que ya existe en META no es un borrador: alternar de modo no debe guardar nada.
    const post = interceptarBorrador();
    montar({ template: plantilla() });

    await userEvent.click(screen.getByRole('button', { name: 'Modo avanzado' }));

    expect(post).not.toHaveBeenCalled();
  });

  it('si META no la deja editar, no se ofrece enviar', async () => {
    montar({
      template: plantilla({ status: 'PENDING' }),
      editPolicy: {
        canEdit: false,
        reason: 'META está revisando esta plantilla.',
        requiresMeta: true,
        limited: false,
        used: 0,
        remaining: null,
        cooldownUntil: null,
        warnings: [],
      },
    });

    expect(screen.getByText(/Todavía no se puede editar/)).toBeInTheDocument();
  });

  it('el asistente parte del contenido que ya tiene la plantilla', async () => {
    // Si arrancara vacío, editar seria reescribir todo.
    montar({ template: plantilla() });

    // Objetivo -> Nombre -> Mensaje
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(screen.getByDisplayValue('Hola, te esperamos.')).toBeInTheDocument();
  });
  it('el aviso del borrador aparece al lado de su botón', async () => {
    // Suelto y más abajo obligaba a buscar qué había pasado: es la respuesta a ese clic.
    interceptarBorrador();
    const { container } = montar();

    const boton = screen.getByRole('button', { name: 'Guardar borrador' });
    await userEvent.click(boton);

    const aviso = await screen.findByText(/No se envió nada a META/);
    expect(aviso).toHaveClass('bo-pl__draftnotice');
    expect(aviso.parentElement).toBe(boton.parentElement);
    expect(container.querySelector('.bo-pl__formactions')).toContainElement(aviso);
  });
});

/**
 * Editar un borrador y editar una plantilla de META son dos cosas distintas, y tratarlas
 * igual rompe las dos: al borrador le faltaba poder guardarse, y el botón de enviar lo
 * guardaba local sin que llegara nada a META.
 */
describe('TemplateEditor — editar un borrador', () => {
  afterEach(() => vi.restoreAllMocks());

  const borrador = () => plantilla({ status: 'DRAFT' });

  it('ofrece guardar borrador', () => {
    // Un borrador nunca salió de acá: sigue siendo un borrador mientras se edita.
    montar({ template: borrador() });
    expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeInTheDocument();
  });

  it('una plantilla que ya está en META no ofrece guardar borrador', () => {
    montar({ template: plantilla({ status: 'APPROVED' }) });
    expect(screen.queryByRole('button', { name: 'Guardar borrador' })).toBeNull();
  });

  it('guarda sobre ese borrador, no crea uno nuevo', async () => {
    // Sin mandar el id, cada guardado dejaría un borrador duplicado y el original intacto.
    const post = interceptarBorrador(99);
    montar({ template: borrador() });

    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0][1] as { draftId: number | null }).draftId).toBe(7);
  });

  it('cambiar de modo guarda sobre ese mismo borrador', async () => {
    // Es lo que fallaba: los cambios quedaban en pantalla pero no en el borrador.
    const post = interceptarBorrador(7);
    montar({ template: borrador() });

    await userEvent.click(screen.getByRole('button', { name: 'Modo avanzado' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe('/api/templates/drafts');
    expect((post.mock.calls[0][1] as { draftId: number | null }).draftId).toBe(7);
  });

  it('el botón dice "Enviar", no "reenviar": nunca estuvo en revisión', async () => {
    montar({ template: borrador() });

    await userEvent.click(screen.getByRole('button', { name: /^\d?\s*Revisión$/ }));

    expect(screen.getByRole('button', { name: 'Enviar a revisión' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reenviar/ })).toBeNull();
  });

  it('en una plantilla de META sí dice reenviar', async () => {
    montar({ template: plantilla({ status: 'APPROVED' }) });

    await userEvent.click(screen.getByRole('button', { name: /^\d?\s*Revisión$/ }));

    expect(
      screen.getByRole('button', { name: 'Guardar y reenviar a revisión' }),
    ).toBeInTheDocument();
  });
});
