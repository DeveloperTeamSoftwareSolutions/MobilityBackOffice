import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TemplatePreview } from './TemplatePreview';
import { Template } from './plantillas.types';

function template(over: Partial<Template> = {}): Template {
  return {
    id: 1,
    name: 'template_reminder',
    language: 'es_MX',
    category: 'MARKETING',
    status: 'APPROVED',
    headerType: null,
    headerContent: null,
    bodyText: 'Hola {{1}}, tu cita es el {{2}}.',
    footerText: null,
    buttons: [],
    createdAt: null,
    variables: ['1', '2'],
    ...over,
  };
}

/**
 * La vista previa es lo que hace util la pantalla: los campos sueltos que devuelve WABA
 * (`HeaderContent`, `BodyText`, `FooterText`, `ButtonsJson`) no dejan ver el mensaje que
 * le llega al cliente.
 */
describe('TemplatePreview', () => {
  it('arma el mensaje con su texto', () => {
    const { container } = render(<TemplatePreview template={template()} />);
    expect(container.textContent).toContain('Hola');
    expect(container.textContent).toContain('tu cita es el');
  });

  it('resalta las variables', () => {
    // Sin resaltarlas no se distingue lo fijo de lo que se completa al enviar.
    const { container } = render(<TemplatePreview template={template()} />);
    const vars = container.querySelectorAll('.bo-pl__var');
    expect(vars).toHaveLength(2);
    expect(vars[0].textContent).toBe('{{1}}');
    expect(vars[1].textContent).toBe('{{2}}');
  });

  it('el texto queda completo con las variables adentro', () => {
    const { container } = render(<TemplatePreview template={template()} />);
    expect(container.textContent).toContain('Hola {{1}}, tu cita es el {{2}}.');
  });

  it('muestra el encabezado de texto', () => {
    render(
      <TemplatePreview
        template={template({ headerType: 'TEXT', headerContent: 'Recordatorio' })}
      />,
    );
    expect(screen.getByText('Recordatorio')).toBeInTheDocument();
  });

  it('un encabezado multimedia se muestra por su tipo', () => {
    // No hay imagen que mostrar: la plantilla define el hueco, no el contenido.
    render(<TemplatePreview template={template({ headerType: 'IMAGE' })} />);
    expect(screen.getByText('Imagen')).toBeInTheDocument();
  });

  it('sin encabezado no dibuja ninguno', () => {
    const { container } = render(<TemplatePreview template={template({ headerType: 'NONE' })} />);
    expect(container.querySelector('.bo-pl__header')).toBeNull();
  });

  it('muestra el pie cuando existe', () => {
    render(<TemplatePreview template={template({ footerText: 'Duwest' })} />);
    expect(screen.getByText('Duwest')).toBeInTheDocument();
  });

  it('lista los botones con su destino', () => {
    render(
      <TemplatePreview
        template={template({
          buttons: [{ type: 'URL', text: 'Ver más', url: 'https://duwest.com', phoneNumber: null }],
        })}
      />,
    );
    expect(screen.getByText('Ver más → https://duwest.com')).toBeInTheDocument();
  });

  it('una plantilla sin cuerpo lo dice en vez de quedar en blanco', () => {
    render(<TemplatePreview template={template({ bodyText: null })} />);
    expect(screen.getByText('Sin texto')).toBeInTheDocument();
  });

  it('un cuerpo sin variables se muestra entero igual', () => {
    const { container } = render(
      <TemplatePreview template={template({ bodyText: 'Mensaje fijo', variables: [] })} />,
    );
    expect(container.textContent).toContain('Mensaje fijo');
    expect(container.querySelectorAll('.bo-pl__var')).toHaveLength(0);
  });
  it('aplica el formato de WhatsApp', () => {
    // WhatsApp interpreta *negrita*, _cursiva_ y ~tachado~ en el mensaje real: si acá se
    // mostraran los asteriscos, la vista previa mentiría.
    const { container } = render(
      <TemplatePreview
        template={template({ bodyText: 'Hola *María*, tu _turno_ fue ~cancelado~.' })}
      />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('María');
    expect(container.querySelector('em')?.textContent).toBe('turno');
    expect(container.querySelector('s')?.textContent).toBe('cancelado');
  });

  it('no deja los asteriscos a la vista', () => {
    const { container } = render(
      <TemplatePreview template={template({ bodyText: 'Hola *María*' })} />,
    );
    expect(container.textContent).not.toContain('*');
  });

  it('dibuja la burbuja sobre el fondo del chat', () => {
    // Sin el fondo, un mensaje claro no se distingue del blanco de la tarjeta.
    const { container } = render(<TemplatePreview template={template()} />);
    expect(container.querySelector('.bo-pl__chat')).not.toBeNull();
    expect(container.querySelector('.bo-pl__bubble')).not.toBeNull();
  });

  it('los botones van fuera de la burbuja, como los dibuja WhatsApp', () => {
    const { container } = render(
      <TemplatePreview
        template={template({
          buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar', url: null, phoneNumber: null }],
        })}
      />,
    );
    expect(container.querySelector('.bo-pl__bubble .bo-pl__buttons')).toBeNull();
    expect(container.querySelector('.bo-pl__chat > .bo-pl__buttons')).not.toBeNull();
  });
});

describe('TemplatePreview con ejemplos', () => {
  const conVariables = () =>
    template({ bodyText: 'Hola {{1}}, tu cita es el {{2}}.' });

  it('muestra el ejemplo en lugar del {{n}}', () => {
    // Es la pregunta que responde la vista previa: al cliente no le llega "{{1}}",
    // le llega un nombre.
    const { container } = render(
      <TemplatePreview
        template={conVariables()}
        ejemplos={[
          { index: 1, target: 'body', label: 'nombre', example: 'María' },
          { index: 2, target: 'body', label: 'fecha', example: '12 de marzo' },
        ]}
      />,
    );

    expect(container.textContent).toContain('Hola María, tu cita es el 12 de marzo.');
    expect(container.textContent).not.toContain('{{1}}');
  });

  it('el ejemplo sigue resaltado', () => {
    // Sin resaltarlo se leería como texto fijo, y ese pedazo cambia en cada envío.
    const { container } = render(
      <TemplatePreview
        template={conVariables()}
        ejemplos={[{ index: 1, target: 'body', label: '', example: 'María' }]}
      />,
    );

    const marcadas = Array.from(container.querySelectorAll('.bo-pl__var')).map(
      (e) => e.textContent,
    );
    expect(marcadas).toContain('María');
  });

  it('sin ejemplo cargado se sigue viendo el {{n}}', () => {
    const { container } = render(
      <TemplatePreview
        template={conVariables()}
        ejemplos={[{ index: 1, target: 'body', label: 'nombre', example: '   ' }]}
      />,
    );
    expect(container.textContent).toContain('{{1}}');
  });

  it('el ejemplo del encabezado no se usa en el cuerpo', () => {
    // META numera encabezado y cuerpo por separado: los dos tienen un {{1}} distinto.
    const { container } = render(
      <TemplatePreview
        template={template({ headerType: 'TEXT', headerContent: 'Hola {{1}}', bodyText: 'Turno {{1}}' })}
        ejemplos={[
          { index: 1, target: 'header', label: '', example: 'María' },
          { index: 1, target: 'body', label: '', example: 'confirmado' },
        ]}
      />,
    );

    expect(container.textContent).toContain('Hola María');
    expect(container.textContent).toContain('Turno confirmado');
  });

  it('sin ejemplos se comporta como antes', () => {
    // La lista no los tiene: solo llega lo que devuelve WABA.
    const { container } = render(<TemplatePreview template={conVariables()} />);
    expect(container.textContent).toContain('{{1}}');
    expect(container.textContent).toContain('{{2}}');
  });
});
