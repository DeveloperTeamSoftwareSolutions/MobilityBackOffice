import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeaderMediaUpload } from './HeaderMediaUpload';
import { TemplateFormState } from './plantillas.types';
import { httpClient } from '../../api/httpClient';

/**
 * Se intercepta el cliente HTTP y no el módulo de API: así el test recorre el
 * `uploadSample` real —incluido el `FormData` que se arma— en vez de darlo por bueno.
 */
function interceptar() {
  return vi.spyOn(httpClient, 'post');
}

function form(over: Partial<TemplateFormState> = {}): TemplateFormState {
  return {
    friendlyTitle: '',
    name: 'promo_navidad',
    language: 'es_MX',
    category: 'MARKETING',
    headerType: 'IMAGE',
    headerContent: '',
    headerHandle: '',
    headerFileName: '',
    bodyText: 'Hola',
    footerText: '',
    buttons: [],
    addSecurityRecommendation: false,
    codeExpirationMinutes: '',
    otpType: 'COPY_CODE',
    variables: [],
    ...over,
  };
}

/** Monta con estado propio, como lo usa el formulario. */
function montar(inicial: Partial<TemplateFormState> = {}) {
  let actual = form(inicial);
  const set = vi.fn((k: keyof TemplateFormState, v: unknown) => {
    actual = { ...actual, [k]: v };
    vista.rerender(<HeaderMediaUpload form={actual} set={set as never} saving={false} id="f" />);
  });
  const vista = render(
    <HeaderMediaUpload form={actual} set={set as never} saving={false} id="f" />,
  );
  return { set };
}

const archivo = (nombre = 'promo.png', tipo = 'image/png') =>
  new File(['x'], nombre, { type: tipo });

const subir = (f = archivo()) =>
  userEvent.upload(screen.getByLabelText('Archivo de ejemplo'), f);

/**
 * Lo que se sube NO es el archivo que reciben los clientes: es el ejemplo que META exige
 * para revisar la plantilla. Es la confusión más probable de la pantalla, así que se
 * verifica que esté dicha.
 */
describe('HeaderMediaUpload', () => {
  afterEach(() => vi.restoreAllMocks());

  it('aclara que no es el archivo que se envía a los clientes', () => {
    montar();
    expect(screen.getByText(/No es el archivo que se envía a los clientes/)).toBeInTheDocument();
  });

  it('guarda el handle que devuelve META, no el archivo', async () => {
    // El archivo no vuelve a viajar: al reenviar la plantilla solo va el handle.
    const post = interceptar().mockResolvedValue({
      data: { success: true, data: { handle: 'h:abc123', fileName: 'promo.png', mimeType: 'image/png' } },
    });
    const { set } = montar();

    await subir();

    await waitFor(() => expect(set).toHaveBeenCalledWith('headerHandle', 'h:abc123'));
    expect(set).toHaveBeenCalledWith('headerFileName', 'promo.png');
    expect(post.mock.calls[0][0]).toBe('/api/templates/upload-sample');
  });

  it('manda el archivo y el tipo de encabezado', async () => {
    // Sin el tipo, el servidor no sabe qué formatos admitir ni cómo pedírselo a META.
    const post = interceptar().mockResolvedValue({
      data: { success: true, data: { handle: 'h:1', fileName: 'promo.png', mimeType: 'image/png' } },
    });
    montar({ headerType: 'VIDEO' });

    // El `accept` del input filtra por tipo: un PNG ni siquiera dispararia el cambio.
    await subir(archivo('promo.mp4', 'video/mp4'));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const enviado = post.mock.calls[0][1] as FormData;
    expect(enviado.get('headerType')).toBe('VIDEO');
    expect((enviado.get('file') as File).name).toBe('promo.mp4');
  });

  it('muestra el archivo cargado y permite quitarlo', async () => {
    const { set } = montar({ headerHandle: 'h:abc', headerFileName: 'promo.png' });
    expect(screen.getByText('promo.png')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(set).toHaveBeenCalledWith('headerHandle', '');
  });

  it('si la subida falla, limpia el handle anterior', async () => {
    // Dejar un handle viejo junto a un archivo nuevo mandaría a META algo distinto de lo
    // que se ve en pantalla.
    interceptar().mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('Request failed'), {
          response: { data: { message: 'Ese tipo de archivo no sirve' } },
        }),
      ),
    );
    const { set } = montar({ headerHandle: 'h:viejo', headerFileName: 'viejo.png' });

    await subir();

    await waitFor(() =>
      expect(screen.getByText('Ese tipo de archivo no sirve')).toBeInTheDocument(),
    );
    expect(set).toHaveBeenCalledWith('headerHandle', '');
  });

  it('solo ofrece los formatos que acepta META para el tipo elegido', () => {
    montar({ headerType: 'DOCUMENT' });
    expect(screen.getByLabelText('Archivo de ejemplo')).toHaveAttribute(
      'accept',
      'application/pdf',
    );
  });
});
