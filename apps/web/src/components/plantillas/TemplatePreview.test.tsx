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
});
