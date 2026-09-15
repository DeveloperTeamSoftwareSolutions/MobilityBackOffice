import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { TemplateWizard } from './TemplateWizard';
import { estadoInicial } from './TemplateForm';
import { Template, TemplateFormState } from './plantillas.types';

/** Monta el asistente con estado propio, como hace `TemplateEditor`. */
function montar(template: Template | null = null) {
  function Host() {
    const [form, setForm] = useState<TemplateFormState>(() => estadoInicial(template));
    return (
      <TemplateWizard
        form={form}
        setForm={setForm}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        onAdvanced={vi.fn()}
        saving={false}
        serverErrors={[]}
        onSaveDraft={null}
        savingDraft={false}
        draftNotice={null}
        template={template}
        editPolicy={null}
      />
    );
  }
  return render(<Host />);
}

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

/** El botón de un paso de la barra superior. */
const paso = (nombre: string) =>
  screen.getByRole('button', { name: new RegExp(`\\d\\s*${nombre}`) });

describe('TemplateWizard — navegación por pasos', () => {
  it('creando, no se puede saltear un paso sin completar el anterior', () => {
    // El formulario arranca vacío: falta el título, así que "Mensaje" no es alcanzable.
    montar();
    expect(paso('Mensaje')).toBeDisabled();
  });

  it('el paso apagado explica qué falta', () => {
    // Un paso apagado sin motivo deja a la persona adivinando.
    montar();
    expect(paso('Mensaje')).toHaveAttribute('title', expect.stringContaining('título'));
  });

  it('editando, todos los pasos están disponibles desde el arranque', () => {
    // La plantilla ya trae todo cargado: obligar a recorrerla en orden sería absurdo.
    montar(plantilla());
    expect(paso('Mensaje')).toBeEnabled();
    expect(paso('Botones')).toBeEnabled();
    expect(paso('Revisión')).toBeEnabled();
  });

  it('se puede volver a un paso ya completo con un clic', async () => {
    montar(plantilla());

    await userEvent.click(paso('Revisión'));
    expect(screen.getByText('Revisá antes de enviar')).toBeInTheDocument();

    // Desde el final, directo al paso 3 sin pasar por los del medio.
    await userEvent.click(paso('Mensaje'));
    expect(screen.getByDisplayValue('Hola, te esperamos.')).toBeInTheDocument();
  });

  it('el paso actual se marca para lectores de pantalla', () => {
    montar(plantilla());
    expect(paso('Objetivo')).toHaveAttribute('aria-current', 'step');
    expect(paso('Mensaje')).not.toHaveAttribute('aria-current');
  });

  it('completar un paso habilita el siguiente sin recargar nada', async () => {
    montar();
    expect(paso('Mensaje')).toBeDisabled();

    await userEvent.click(paso('Nombre'));
    await userEvent.type(screen.getByLabelText(/Título/), 'Recordatorio de turno');

    expect(paso('Mensaje')).toBeEnabled();
  });
});

describe('TemplateWizard — la categoría de META', () => {
  it('cada objetivo dice a qué categoría corresponde', () => {
    // Quien arma piensa en "promocionar"; META, el costo y el resto del equipo hablan
    // de MARKETING. Si la pantalla no lo dice, la traducción queda en cada cabeza.
    montar();

    const promocionar = screen.getByText('Promocionar algo o dar novedades').closest('span');
    expect(within(promocionar as HTMLElement).getByText('Marketing')).toBeInTheDocument();

    const avisar = screen.getByText('Avisar algo a un cliente').closest('span');
    expect(within(avisar as HTMLElement).getByText('Utilidad')).toBeInTheDocument();

    const codigo = screen.getByText('Enviar un código de verificación').closest('span');
    expect(within(codigo as HTMLElement).getByText('Autenticación')).toBeInTheDocument();
  });
});

describe('TemplateWizard — un error no se ve igual que un aviso', () => {
  /** Una plantilla completa salvo el botón, que quedó sin teléfono. */
  const conError = () =>
    plantilla({
      buttons: [{ type: 'PHONE_NUMBER', text: 'Llamar', url: null, phoneNumber: null }],
    });

  it('lo que hay que corregir y lo que solo hay que saber usan estilos distintos', async () => {
    // Tenían los dos el mismo ámbar: "el botón necesita un teléfono" se leía igual que
    // "al enviarla queda en revisión", y uno frena mientras el otro solo informa.
    const { container } = montar(conError());

    await userEvent.click(paso('Revisión'));

    const error = screen.getByText(/Hay que corregir esto/).closest('div');
    expect(error).toHaveClass('bo-pl__warn');

    const aviso = container.querySelector('.bo-pl__notice--tight');
    expect(aviso?.textContent).toMatch(/revisión de META/);
    expect(aviso).not.toHaveClass('bo-pl__warn');
  });

  it('el aviso queda pegado a la botonera, no arriba del todo', async () => {
    // Lejos del botón, no se leía como "esto pasa si aprieto acá".
    const { container } = montar(plantilla());

    await userEvent.click(paso('Revisión'));

    const aviso = container.querySelector('.bo-pl__notice--tight');
    const acciones = container.querySelector('.bo-pl__formactions');
    expect(aviso?.nextElementSibling).toBe(acciones);
  });

  it('el aviso solo aparece en el último paso', () => {
    const { container } = montar(plantilla());
    expect(container.querySelector('.bo-pl__notice--tight')).toBeNull();
  });

  it('editando una aprobada, el aviso dice que vuelve a revisión', async () => {
    const { container } = montar(plantilla({ status: 'APPROVED' }));

    await userEvent.click(paso('Revisión'));

    expect(container.querySelector('.bo-pl__notice--tight')?.textContent).toMatch(
      /vuelve a revisión/,
    );
  });
});
