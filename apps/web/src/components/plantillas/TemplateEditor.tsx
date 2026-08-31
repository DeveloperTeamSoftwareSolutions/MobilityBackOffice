import { useCallback, useRef, useState } from 'react';
import { EditPolicy, Template, TemplateDraft, TemplateFormState } from './plantillas.types';
import { aPayload, mensajesDeError, saveDraft } from './plantillas.api';
import { estadoDesdeBorrador, estadoInicial, TemplateForm } from './TemplateForm';
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
 * **Editar tambien arranca en el asistente**, igual que crear. Lo que cambia es que el
 * nombre y el idioma quedan bloqueados: META los toma como identidad de la plantilla y
 * no los deja cambiar. El resto se recorre igual, y se puede pasar al modo avanzado.
 */
export function TemplateEditor({
  template,
  editPolicy,
  draft,
  onCancel,
  onSubmit,
  saving,
  serverErrors,
}: {
  /** `null` = alta. Con plantilla = edición. */
  template: Template | null;
  editPolicy: EditPolicy | null;
  /**
   * El borrador guardado, cuando lo que se abre es un borrador.
   *
   * Se rehidrata de aca y no del detalle de la plantilla: el detalle no tiene el titulo,
   * ni el archivo, ni el **ejemplo de cada variable** —solo los numeros—, y META exige
   * los ejemplos. `null` si no se pudo traer: se arma con lo que haya.
   */
  draft: TemplateDraft | null;
  onCancel: () => void;
  onSubmit: (form: TemplateFormState) => void;
  saving: boolean;
  serverErrors: string[];
}) {
  const esEdicion = template !== null;

  /**
   * Un borrador **no vive en META**: se edita como cualquier otro borrador.
   *
   * La distincion no es cosmetica. Sin ella "editar" tapaba dos cosas muy distintas:
   * corregir algo que META ya aprobo, y seguir armando algo que nunca salio de aca. Al
   * segundo hay que ofrecerle guardar el avance, y el cambio de modo tiene que caer
   * sobre **ese** borrador y no crear uno nuevo.
   */
  const esBorrador = template?.status === 'DRAFT';
  const puedeGuardarBorrador = !esEdicion || esBorrador;
  const [form, setForm] = useState<TemplateFormState>(() =>
    draft ? estadoDesdeBorrador(draft) : estadoInicial(template),
  );
  // Crear y editar arrancan igual: en el asistente. Es la forma en la que la pantalla
  // explica cada paso, y no hay motivo para negarsela a quien corrige una plantilla.
  const [modo, setModo] = useState<'wizard' | 'avanzado'>('wizard');

  const [guardandoBorrador, setGuardandoBorrador] = useState(false);
  const [avisoBorrador, setAvisoBorrador] = useState<string | null>(null);

  /**
   * El id del borrador ya creado, en una ref y no en estado.
   *
   * Se lee dentro del guardado, no se dibuja: en estado, dos guardados seguidos podrían
   * leer el mismo valor viejo y crear un borrador duplicado por cada uno.
   */
  // Al editar un borrador se sigue trabajando sobre ESE, no sobre uno nuevo.
  const draftId = useRef<number | null>(esBorrador ? (template?.id ?? null) : null);

  /**
   * Guarda el avance sin mandar nada a META.
   *
   * Una plantilla se arma en varias sesiones —hay que conseguir el texto aprobado, el
   * arte del encabezado— y hasta acá lo único que existía era enviarla o perderla.
   */
  const guardarBorrador = useCallback(
    async (f: TemplateFormState, silencioso = false): Promise<boolean> => {
      // Lo que ya existe en META no es un borrador; lo que todavia es borrador, si.
      if (!puedeGuardarBorrador) return false;

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
    [puedeGuardarBorrador],
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
    onSaveDraft: puedeGuardarBorrador ? () => guardarBorrador(form) : null,
    savingDraft: guardandoBorrador,
    draftNotice: avisoBorrador,
    // El asistente y el modo avanzado necesitan saberlo para bloquear nombre e idioma.
    template,
    editPolicy,
  };

  if (modo === 'wizard') {
    return <TemplateWizard {...comun} onAdvanced={() => cambiarModo('avanzado')} />;
  }

  return <TemplateForm {...comun} onWizard={() => cambiarModo('wizard')} />;
}
