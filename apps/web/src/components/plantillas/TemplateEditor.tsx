import { useCallback, useRef, useState } from 'react';
import { EditPolicy, Template, TemplateFormState } from './plantillas.types';
import { aPayload, mensajesDeError, saveDraft } from './plantillas.api';
import { estadoInicial, TemplateForm } from './TemplateForm';
import { TemplateWizard } from './TemplateWizard';

/**
 * Contenedor de alta y edición: decide entre el asistente y el modo avanzado.
 *
 * **El estado vive acá**, no en cada modo. Por eso alternar conserva todo lo cargado: se
 * cambia qué se dibuja, no los datos.
 *
 * WABA hace lo mismo pero por otra vía — guarda un borrador en la base y redirige
 * (`/templates/new?draft=<id>`), porque son dos páginas distintas del servidor. Acá es
 * una sola pantalla, así que el cambio es inmediato.
 *
 * Aun así el borrador **también** se guarda al alternar, como en WABA: el estado en
 * memoria se pierde si se cierra la pestaña, y el borrador sobrevive. Que falle no
 * bloquea el cambio de modo — sería cambiar una molestia por otra peor.
 *
 * **Editar entra directo al modo avanzado.** El asistente está pensado para armar desde
 * cero: pregunta el objetivo y propone el nombre técnico, dos cosas que en una plantilla
 * existente ya están decididas y META no deja cambiar.
 */
export function TemplateEditor({
  template,
  editPolicy,
  onCancel,
  onSubmit,
  saving,
  serverErrors,
}: {
  /** `null` = alta. Con plantilla = edición. */
  template: Template | null;
  editPolicy: EditPolicy | null;
  onCancel: () => void;
  onSubmit: (form: TemplateFormState) => void;
  saving: boolean;
  serverErrors: string[];
}) {
  const esEdicion = template !== null;
  const [form, setForm] = useState<TemplateFormState>(() => estadoInicial(template));
  const [modo, setModo] = useState<'wizard' | 'avanzado'>(esEdicion ? 'avanzado' : 'wizard');

  const [guardandoBorrador, setGuardandoBorrador] = useState(false);
  const [avisoBorrador, setAvisoBorrador] = useState<string | null>(null);

  /**
   * El id del borrador ya creado, en una ref y no en estado.
   *
   * Se lee dentro del guardado, no se dibuja: en estado, dos guardados seguidos podrían
   * leer el mismo valor viejo y crear un borrador duplicado por cada uno.
   */
  const draftId = useRef<number | null>(null);

  /**
   * Guarda el avance sin mandar nada a META.
   *
   * Una plantilla se arma en varias sesiones —hay que conseguir el texto aprobado, el
   * arte del encabezado— y hasta acá lo único que existía era enviarla o perderla.
   */
  const guardarBorrador = useCallback(
    async (f: TemplateFormState, silencioso = false): Promise<boolean> => {
      if (esEdicion) return false; // Una plantilla que ya existe en META no es un borrador.

      setGuardandoBorrador(true);
      if (!silencioso) setAvisoBorrador(null);
      try {
        const id = await saveDraft({
          ...aPayload(f),
          draftId: draftId.current,
          // El título no va a META, pero es con lo que se reconoce el borrador después.
          friendlyTitle: f.friendlyTitle || null,
        });
        if (id !== null) draftId.current = id;
        setAvisoBorrador('Borrador guardado. No se envió nada a META.');
        return true;
      } catch (err) {
        setAvisoBorrador(mensajesDeError(err)[0]);
        return false;
      } finally {
        setGuardandoBorrador(false);
      }
    },
    [esEdicion],
  );

  /**
   * Cambia de modo guardando antes, como hace WABA.
   *
   * El `await` es deliberado pero no bloqueante en el resultado: si el guardado falla, se
   * cambia igual y queda el aviso. Perder el modo por un error de red sería peor que
   * quedarse sin borrador, porque los datos siguen en pantalla.
   */
  const cambiarModo = async (destino: 'wizard' | 'avanzado') => {
    await guardarBorrador(form, true);
    setModo(destino);
  };

  const comun = {
    form,
    setForm,
    onCancel,
    onSubmit: () => onSubmit(form),
    saving,
    serverErrors,
    onSaveDraft: esEdicion ? null : () => guardarBorrador(form),
    savingDraft: guardandoBorrador,
    draftNotice: avisoBorrador,
  };

  if (modo === 'wizard') {
    return <TemplateWizard {...comun} onAdvanced={() => cambiarModo('avanzado')} />;
  }

  return (
    <TemplateForm
      {...comun}
      template={template}
      editPolicy={editPolicy}
      onWizard={esEdicion ? null : () => cambiarModo('wizard')}
    />
  );
}
