import { useEffect, useRef, useState } from 'react';
import {
  EditPolicy,
  Template,
  TemplateButton,
  TemplateFormState,
  TemplateVariable,
} from './plantillas.types';
import { EditPolicyNotice } from './EditPolicyNotice';
import { aPayload, mensajesDeError, validateTemplate } from './plantillas.api';
import { HeaderMediaUpload } from './HeaderMediaUpload';
import { JsonBox } from './JsonBox';
import { LIMITS, validateForm } from './plantillas.validate';
import { TemplatePreview } from './TemplatePreview';
import {
  bloqueoDelPaso,
  insertarVariable,
  nombreTecnico,
  pasosDe,
  sincronizarVariables,
} from './wizard.helpers';

/**
 * Asistente paso a paso, espejando el de WABA.
 *
 * La diferencia con el modo avanzado no es cosmética: **el asistente pregunta por el
 * objetivo antes que por los campos**. Elegir "avisar algo a un cliente" en vez de
 * "UTILITY" es lo que permite que alguien de marketing arme una plantilla sin conocer el
 * vocabulario de META.
 *
 * Y pide **un ejemplo por cada variable**, que es lo que META mira para revisar. Sin eso,
 * rechaza — y es de los motivos de rechazo más frecuentes.
 */
export function TemplateWizard({
  form,
  setForm,
  onCancel,
  onSubmit,
  onAdvanced,
  saving,
  serverErrors,
  onSaveDraft,
  savingDraft,
  draftNotice,
  template,
  editPolicy,
}: {
  form: TemplateFormState;
  setForm: (f: TemplateFormState | ((f: TemplateFormState) => TemplateFormState)) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onAdvanced: () => void;
  saving: boolean;
  serverErrors: string[];
  /** Guardar el avance sin enviar. `null` en edición: lo que ya existe en META no es borrador. */
  onSaveDraft: (() => void) | null;
  savingDraft: boolean;
  draftNotice: string | null;
  /** `null` = alta. Con plantilla = edición: nombre e idioma quedan bloqueados. */
  template: Template | null;
  editPolicy: EditPolicy | null;
}) {
  const esEdicion = template !== null;
  // Si META no la deja editar, no se ofrece enviar: el rechazo llegaria igual, pero
  // despues de completar todo el asistente.
  const bloqueadaPorMeta = esEdicion && editPolicy ? editPolicy.canEdit === false : false;

  const [paso, setPaso] = useState(0);
  const pasos = pasosDe(form.category);
  const nombrePaso = pasos[paso];
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const set = <K extends keyof TemplateFormState>(key: K, value: TemplateFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Las variables siguen a los textos: si se borra un {{2}}, su fila se va; si aparece un
  // {{3}}, se suma vacía. Lo ya cargado se conserva.
  useEffect(() => {
    setForm((f) => {
      const next = sincronizarVariables(f);
      const igual =
        next.length === f.variables.length &&
        next.every(
          (v, i) =>
            v.index === f.variables[i].index &&
            v.target === f.variables[i].target &&
            v.label === f.variables[i].label &&
            v.example === f.variables[i].example,
        );
      return igual ? f : { ...f, variables: next };
    });
  }, [form.bodyText, form.headerContent, form.headerType, setForm]);

  // Cambiar de objetivo puede cambiar los pasos: se vuelve a uno que exista.
  useEffect(() => {
    if (paso >= pasos.length) setPaso(pasos.length - 1);
  }, [pasos.length, paso]);

  const bloqueo = bloqueoDelPaso(form, paso);
  const esUltimo = paso === pasos.length - 1;
  const erroresFinales = validateForm(form, false);

  const insertarVar = () => {
    const el = bodyRef.current;
    const pos = el ? (el.selectionStart ?? form.bodyText.length) : form.bodyText.length;
    set('bodyText', insertarVariable(form.bodyText, pos));
    // Devolver el foco: si no, hay que volver a hacer clic para seguir escribiendo.
    requestAnimationFrame(() => el?.focus());
  };

  const setVar = (i: number, patch: Partial<TemplateVariable>) =>
    setForm((f) => ({
      ...f,
      variables: f.variables.map((v, j) => (j === i ? { ...v, ...patch } : v)),
    }));

  return (
    <div className="bo-pl__wizard">
      <div className="bo-pl__formhead">
        <h2 className="bo-pl__formtitle">
          {esEdicion ? `Editar ${template.name} con asistente` : 'Crear plantilla con asistente'}
        </h2>
        <p className="bo-pl__formsub">
          {esEdicion
            ? 'Al guardar, la plantilla vuelve a revisión de META. El nombre y el idioma no se pueden cambiar.'
            : 'Nada se envía a META hasta el último paso.'}
        </p>
      </div>

      {/* Lo que META permite ahora: se dice antes de que alguien escriba. */}
      <EditPolicyNotice policy={esEdicion ? editPolicy : null} />

      {/* ---- Barra de pasos ---- */}
      <ol className="bo-pl__steps">
        {pasos.map((p, i) => (
          <li
            key={p}
            className={`bo-pl__step${i === paso ? ' bo-pl__step--now' : ''}${i < paso ? ' bo-pl__step--done' : ''}`}
          >
            <span className="bo-pl__stepnum">{i + 1}</span>
            <span className="bo-pl__steplabel">{p}</span>
          </li>
        ))}
      </ol>

      {serverErrors.length > 0 && (
        <div className="bo-pl__warn">
          <strong>No se pudo enviar:</strong>
          <ul className="bo-pl__errlist">
            {serverErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="bo-pl__formgrid">
        <div className="bo-pl__formcol">
          {nombrePaso === 'Objetivo' && (
            <PasoObjetivo form={form} set={set} saving={saving} esEdicion={esEdicion} />
          )}
          {nombrePaso === 'Nombre' && (
            <PasoNombre form={form} set={set} saving={saving} esEdicion={esEdicion} />
          )}
          {nombrePaso === 'Mensaje' && (
            <PasoMensaje
              form={form}
              set={set}
              setVar={setVar}
              saving={saving}
              bodyRef={bodyRef}
              onInsertVar={insertarVar}
            />
          )}
          {nombrePaso === 'Extras' && (
            <PasoExtras form={form} set={set} setVar={setVar} saving={saving} />
          )}
          {nombrePaso === 'Botones' && <PasoBotones form={form} setForm={setForm} saving={saving} />}
          {nombrePaso === 'Código' && <PasoCodigo form={form} set={set} saving={saving} />}
          {nombrePaso === 'Revisión' && <PasoRevision form={form} errores={erroresFinales} />}
        </div>

        <div className="bo-pl__formcol">
          <span className="bo-pl__label">Vista previa</span>
          {form.category === 'AUTHENTICATION' ? (
            <p className="bo-pl__hint">
              El texto de estas plantillas lo escribe META y lo traduce. Se ve una vez
              aprobada.
            </p>
          ) : (
            <>
              <TemplatePreview template={comoPlantilla(form)} />
              <span className="bo-pl__hint">
                Vista aproximada. El diseño final lo define WhatsApp.
              </span>
            </>
          )}
        </div>
      </div>

      {bloqueo && <p className="bo-pl__stepblock">{bloqueo}</p>}
      {draftNotice && <p className="bo-pl__notice">{draftNotice}</p>}

      <div className="bo-pl__formactions">
        <button type="button" className="bo-pl__btn" onClick={onAdvanced} disabled={saving}>
          Modo avanzado
        </button>
        {/* Guardar sin enviar: una plantilla se arma en varias sesiones. */}
        {onSaveDraft && (
          <button
            type="button"
            className="bo-pl__btn"
            onClick={onSaveDraft}
            disabled={saving || savingDraft}
          >
            {savingDraft ? 'Guardando…' : 'Guardar borrador'}
          </button>
        )}
        <span className="bo-pl__spacer" />
        <button type="button" className="bo-pl__btn" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button
          type="button"
          className="bo-pl__btn"
          onClick={() => setPaso((p) => Math.max(0, p - 1))}
          disabled={paso === 0 || saving}
        >
          Anterior
        </button>
        {esUltimo ? (
          <button
            type="button"
            className="bo-pl__btn bo-pl__btn--primary"
            onClick={onSubmit}
            disabled={saving || bloqueadaPorMeta || erroresFinales.length > 0}
          >
            {saving
              ? 'Enviando…'
              : esEdicion
                ? 'Guardar y reenviar a revisión'
                : 'Enviar a revisión'}
          </button>
        ) : (
          <button
            type="button"
            className="bo-pl__btn bo-pl__btn--primary"
            onClick={() => setPaso((p) => p + 1)}
            disabled={saving || bloqueo !== null}
          >
            Siguiente
          </button>
        )}
      </div>
    </div>
  );
}

function comoPlantilla(form: TemplateFormState) {
  return {
    id: null,
    name: form.name,
    language: form.language,
    category: form.category,
    status: null,
    headerType: form.headerType,
    headerContent: form.headerContent,
    bodyText: form.bodyText,
    footerText: form.footerText,
    buttons: form.buttons,
    variables: form.variables.map((v) => String(v.index)),
  };
}

type Set = <K extends keyof TemplateFormState>(k: K, v: TemplateFormState[K]) => void;

/**
 * Paso 1 — el objetivo, no la categoría.
 *
 * Es la diferencia central con el modo avanzado: se pregunta para qué sirve el mensaje,
 * en lenguaje llano, y de ahí sale la categoría de META.
 */
function PasoObjetivo({
  form,
  set,
  saving,
  esEdicion,
}: {
  form: TemplateFormState;
  set: Set;
  saving: boolean;
  esEdicion: boolean;
}) {
  const opciones = [
    {
      value: 'UTILITY',
      label: 'Avisar algo a un cliente',
      hint: 'Confirmaciones, recordatorios, estado de un pedido, alertas de servicio.',
    },
    {
      value: 'MARKETING',
      label: 'Promocionar algo o dar novedades',
      hint: 'Ofertas, lanzamientos, invitaciones, saludos comerciales.',
    },
    {
      value: 'AUTHENTICATION',
      label: 'Enviar un código de verificación',
      hint: 'Códigos de un solo uso para iniciar sesión o confirmar identidad.',
    },
  ];

  return (
    <>
      <h3 className="bo-pl__steptitle">¿Para qué vas a usar esta plantilla?</h3>
      <p className="bo-pl__hint">
        Elegí la opción que mejor describa tu mensaje. Esto define cómo la revisa META.
      </p>

      <div className="bo-pl__choices">
        {opciones.map((o) => (
          <label
            key={o.value}
            className={`bo-pl__choice${form.category === o.value ? ' bo-pl__choice--on' : ''}`}
          >
            <input
              type="radio"
              name="objetivo"
              value={o.value}
              checked={form.category === o.value}
              disabled={saving}
              onChange={() => set('category', o.value)}
            />
            <span>
              <span className="bo-pl__choicelabel">{o.label}</span>
              <span className="bo-pl__hint">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {esEdicion && (
        <p className="bo-pl__notice">
          Cambiar el objetivo de una plantilla que ya existe hace que META la revise de
          nuevo desde cero, y puede cambiarle el costo por envio.
        </p>
      )}

      {form.category === 'MARKETING' && (
        <p className="bo-pl__notice">
          Las plantillas promocionales tienen un costo por envío más alto y META es más
          estricta al revisarlas.
        </p>
      )}
      {form.category === 'AUTHENTICATION' && (
        <p className="bo-pl__notice">
          META define el texto de estos mensajes y lo traduce solo. En el paso del código
          únicamente se eligen las opciones.
        </p>
      )}
    </>
  );
}

/** Paso 2 — un título para reconocerla, y de ahí sale el nombre técnico. */
function PasoNombre({
  form,
  set,
  saving,
  esEdicion,
}: {
  form: TemplateFormState;
  set: Set;
  saving: boolean;
  esEdicion: boolean;
}) {
  const [tocado, setTocado] = useState(false);

  const cambiarTitulo = (v: string) => {
    set('friendlyTitle', v);
    // Mientras no lo editen a mano, el nombre técnico sigue al título. En edición no:
    // el nombre ya existe en META y arrastrarlo lo dejaría distinto del real.
    if (!tocado && !esEdicion) set('name', nombreTecnico(v));
  };

  return (
    <>
      <h3 className="bo-pl__steptitle">
        {esEdicion ? 'Nombre e idioma' : '¿Cómo querés llamarla?'}
      </h3>

      {esEdicion && (
        <p className="bo-pl__notice">
          META toma el nombre y el idioma como <strong>identidad</strong> de la plantilla:
          no se pueden cambiar. Para otro nombre hay que crear una plantilla nueva.
        </p>
      )}

      <div className="bo-pl__field">
        <label className="bo-pl__label" htmlFor="wz-title">
          Título <span className="bo-pl__opt">(solo para que la reconozcas)</span>
        </label>
        <input
          id="wz-title"
          className="bo-pl__input"
          value={form.friendlyTitle}
          disabled={saving}
          placeholder="Ej: Recordatorio de turno"
          onChange={(e) => cambiarTitulo(e.target.value)}
        />
      </div>

      <div className="bo-pl__field">
        <label className="bo-pl__label" htmlFor="wz-name">
          Nombre técnico
        </label>
        <input
          id="wz-name"
          className="bo-pl__input"
          value={form.name}
          disabled={saving || esEdicion}
          maxLength={LIMITS.NAME_MAX}
          onChange={(e) => {
            setTocado(true);
            set('name', e.target.value.toLowerCase().replace(/\s+/g, '_'));
          }}
        />
        <span className="bo-pl__hint">
          {esEdicion
            ? 'Es el que usa META como identidad de la plantilla. No se puede cambiar.'
            : 'Es el que usa META. Lo generamos del título. Solo minúsculas, números y guiones bajos. No se puede cambiar después.'}
        </span>
      </div>

      <div className="bo-pl__field">
        <label className="bo-pl__label" htmlFor="wz-lang">
          Idioma
        </label>
        <select
          id="wz-lang"
          className="bo-pl__input"
          value={form.language}
          disabled={saving || esEdicion}
          onChange={(e) => set('language', e.target.value)}
        >
          <option value="es_MX">Español (MX)</option>
          <option value="es_ES">Español (ES)</option>
          <option value="es">Español</option>
          <option value="en_US">Inglés (US)</option>
          <option value="pt_BR">Portugués (BR)</option>
        </select>
        <span className="bo-pl__hint">
          {esEdicion ? 'Tampoco se puede cambiar.' : 'Tampoco se puede cambiar después.'}
        </span>
      </div>
    </>
  );
}

/** Paso 3 — el mensaje y sus datos variables. */
function PasoMensaje({
  form,
  set,
  setVar,
  saving,
  bodyRef,
  onInsertVar,
}: {
  form: TemplateFormState;
  set: Set;
  setVar: (i: number, patch: Partial<TemplateVariable>) => void;
  saving: boolean;
  bodyRef: React.RefObject<HTMLTextAreaElement>;
  onInsertVar: () => void;
}) {
  const delCuerpo = form.variables
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v.target === 'body');

  return (
    <>
      <h3 className="bo-pl__steptitle">Escribí tu mensaje</h3>

      <div className="bo-pl__field">
        <textarea
          ref={bodyRef}
          className="bo-pl__textarea"
          rows={7}
          value={form.bodyText}
          disabled={saving}
          maxLength={LIMITS.BODY_MAX}
          placeholder="Hola, te recordamos que tenés un turno pendiente."
          onChange={(e) => set('bodyText', e.target.value)}
        />
        <div className="bo-pl__inline">
          <button type="button" className="bo-pl__btn bo-pl__btn--sm" disabled={saving} onClick={onInsertVar}>
            Insertar dato variable
          </button>
          <span className="bo-pl__hint">
            {form.bodyText.length}/{LIMITS.BODY_MAX}
          </span>
        </div>
        <span className="bo-pl__hint">
          Para los datos que cambian en cada envío (un nombre, una fecha) usá un dato
          variable.
        </span>
      </div>

      {delCuerpo.length > 0 && (
        <div className="bo-pl__field">
          <span className="bo-pl__label">Datos variables</span>
          <span className="bo-pl__hint">
            Ponele un nombre a cada uno y un ejemplo real. <strong>META usa el ejemplo para
            revisar la plantilla</strong>, así que sin eso la rechaza.
          </span>

          {delCuerpo.map(({ v, i }) => (
            <div key={`${v.target}-${v.index}`} className="bo-pl__varrow">
              <span className="bo-pl__vartag">{`{{${v.index}}}`}</span>
              <input
                className="bo-pl__input bo-pl__input--sm"
                value={v.label}
                disabled={saving}
                placeholder="Qué es (ej: nombre del cliente)"
                aria-label={`Nombre de la variable ${v.index}`}
                onChange={(e) => setVar(i, { label: e.target.value })}
              />
              <input
                className="bo-pl__input bo-pl__input--sm"
                value={v.example}
                disabled={saving}
                placeholder="Ejemplo (ej: María)"
                aria-label={`Ejemplo de la variable ${v.index}`}
                onChange={(e) => setVar(i, { example: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Paso 4 — encabezado y pie. */
function PasoExtras({
  form,
  set,
  setVar,
  saving,
}: {
  form: TemplateFormState;
  set: Set;
  setVar: (i: number, patch: Partial<TemplateVariable>) => void;
  saving: boolean;
}) {
  const delHeader = form.variables
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v.target === 'header');

  return (
    <>
      <h3 className="bo-pl__steptitle">Encabezado y pie</h3>
      <p className="bo-pl__hint">
        Podés agregar un título arriba del mensaje y una línea pequeña abajo. Los dos son
        opcionales.
      </p>

      <div className="bo-pl__field">
        <label className="bo-pl__label" htmlFor="wz-header">
          Encabezado
        </label>
        <select
          id="wz-header"
          className="bo-pl__input"
          value={form.headerType}
          disabled={saving}
          onChange={(e) => set('headerType', e.target.value)}
        >
          <option value="NONE">Sin encabezado</option>
          <option value="TEXT">Texto</option>
          <option value="IMAGE">Imagen</option>
          <option value="VIDEO">Video</option>
          <option value="DOCUMENT">Documento</option>
        </select>
      </div>

      {form.headerType === 'TEXT' && (
        <div className="bo-pl__field">
          <input
            className="bo-pl__input"
            value={form.headerContent}
            disabled={saving}
            maxLength={LIMITS.HEADER_TEXT_MAX}
            placeholder="Ej: Recordatorio de turno"
            aria-label="Texto del encabezado"
            onChange={(e) => set('headerContent', e.target.value)}
          />
          <span className="bo-pl__hint">
            {form.headerContent.length}/{LIMITS.HEADER_TEXT_MAX} · admite una sola variable
          </span>

          {delHeader.map(({ v, i }) => (
            <div key={`h-${v.index}`} className="bo-pl__varrow">
              <span className="bo-pl__vartag">{`{{${v.index}}}`}</span>
              <input
                className="bo-pl__input bo-pl__input--sm"
                value={v.example}
                disabled={saving}
                placeholder="Ejemplo para META"
                aria-label={`Ejemplo de la variable ${v.index} del encabezado`}
                onChange={(e) => setVar(i, { example: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}

      {form.headerType !== 'NONE' && form.headerType !== 'TEXT' && (
        <>
          <p className="bo-pl__hint">
            El archivo que se manda a cada cliente lo elige quien envía el mensaje. Acá se
            define que la plantilla lleva un encabezado de este tipo, y se sube un ejemplo
            para que META pueda revisarla.
          </p>
          <HeaderMediaUpload form={form} set={set} saving={saving} id="wz-headerfile" />
        </>
      )}

      <div className="bo-pl__field">
        <label className="bo-pl__label" htmlFor="wz-footer">
          Pie de mensaje
        </label>
        <input
          id="wz-footer"
          className="bo-pl__input"
          value={form.footerText}
          disabled={saving}
          maxLength={LIMITS.FOOTER_MAX}
          placeholder="Ej: Equipo de Atención al Cliente"
          onChange={(e) => set('footerText', e.target.value)}
        />
        <span className="bo-pl__hint">
          {form.footerText.length}/{LIMITS.FOOTER_MAX} · no admite datos variables
        </span>
      </div>
    </>
  );
}

/** Paso 5 — botones. */
function PasoBotones({
  form,
  setForm,
  saving,
}: {
  form: TemplateFormState;
  setForm: (f: (f: TemplateFormState) => TemplateFormState) => void;
  saving: boolean;
}) {
  const setButton = (i: number, patch: Partial<TemplateButton>) =>
    setForm((f) => ({
      ...f,
      buttons: f.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    }));

  const add = () =>
    setForm((f) => ({
      ...f,
      buttons: [...f.buttons, { type: 'QUICK_REPLY', text: '', url: null, phoneNumber: null }],
    }));

  const remove = (i: number) =>
    setForm((f) => ({ ...f, buttons: f.buttons.filter((_, j) => j !== i) }));

  return (
    <>
      <h3 className="bo-pl__steptitle">Botones</h3>
      <p className="bo-pl__hint">
        Para que la persona pueda responder rápido, abrir un enlace o llamar. Son
        opcionales. Máximo {LIMITS.MAX_QUICK_REPLY} de respuesta rápida,{' '}
        {LIMITS.MAX_URL_BUTTONS} de enlace y {LIMITS.MAX_PHONE_BUTTONS} de llamada.
      </p>

      {form.buttons.map((b, i) => (
        <div key={i} className="bo-pl__btnrow">
          <select
            className="bo-pl__input bo-pl__input--sm"
            value={b.type ?? 'QUICK_REPLY'}
            disabled={saving}
            aria-label={`Tipo del botón ${i + 1}`}
            onChange={(e) => setButton(i, { type: e.target.value, url: null, phoneNumber: null })}
          >
            <option value="QUICK_REPLY">Respuesta rápida</option>
            <option value="URL">Abrir un enlace</option>
            <option value="PHONE_NUMBER">Llamar por teléfono</option>
          </select>

          <input
            className="bo-pl__input bo-pl__input--sm"
            value={b.text ?? ''}
            disabled={saving}
            maxLength={LIMITS.BUTTON_TEXT_MAX}
            placeholder="Texto del botón"
            aria-label={`Texto del botón ${i + 1}`}
            onChange={(e) => setButton(i, { text: e.target.value })}
          />

          {b.type === 'URL' && (
            <input
              className="bo-pl__input bo-pl__input--sm"
              value={b.url ?? ''}
              disabled={saving}
              placeholder="https://…"
              aria-label={`Enlace del botón ${i + 1}`}
              onChange={(e) => setButton(i, { url: e.target.value })}
            />
          )}

          {b.type === 'PHONE_NUMBER' && (
            <input
              className="bo-pl__input bo-pl__input--sm"
              value={b.phoneNumber ?? ''}
              disabled={saving}
              placeholder="+502…"
              aria-label={`Teléfono del botón ${i + 1}`}
              onChange={(e) => setButton(i, { phoneNumber: e.target.value })}
            />
          )}

          <button
            type="button"
            className="bo-pl__btn bo-pl__btn--sm"
            disabled={saving}
            onClick={() => remove(i)}
          >
            Quitar
          </button>
        </div>
      ))}

      <button type="button" className="bo-pl__btn bo-pl__btn--sm" disabled={saving} onClick={add}>
        Agregar botón
      </button>

      {form.buttons.length > 0 && (
        <JsonBox
          titulo="Ver el JSON de los botones"
          valor={form.buttons}
          hint="Es como viajan los botones dentro de la plantilla. Útil para pegárselo a quien integra, o para comparar contra lo que devuelve META."
        />
      )}
    </>
  );
}

/** Paso de AUTHENTICATION — META escribe el texto. */
function PasoCodigo({ form, set, saving }: { form: TemplateFormState; set: Set; saving: boolean }) {
  const conVencimiento = form.codeExpirationMinutes.trim() !== '';

  return (
    <>
      <h3 className="bo-pl__steptitle">Configurá el código de verificación</h3>
      <p className="bo-pl__notice">
        <strong>El texto lo escribe y traduce META automáticamente.</strong> No se puede
        cambiar: estas plantillas tienen un formato fijo.
      </p>

      <div className="bo-pl__field">
        <span className="bo-pl__label">Tipo de botón</span>
        <p className="bo-pl__hint">
          <strong>Copiar código.</strong> Las otras variantes (autocompletado en apps
          Android) necesitan datos técnicos de la app.
        </p>
      </div>

      <div className="bo-pl__field">
        <label className="bo-pl__check">
          <input
            type="checkbox"
            checked={form.addSecurityRecommendation}
            disabled={saving}
            onChange={(e) => set('addSecurityRecommendation', e.target.checked)}
          />
          <span>Agregar la leyenda &ldquo;no compartas este código&rdquo;</span>
        </label>
      </div>

      <div className="bo-pl__field">
        <label className="bo-pl__check">
          <input
            type="checkbox"
            checked={conVencimiento}
            disabled={saving}
            onChange={(e) => set('codeExpirationMinutes', e.target.checked ? '10' : '')}
          />
          <span>El código vence después de un tiempo</span>
        </label>
      </div>

      {conVencimiento && (
        <div className="bo-pl__field">
          <label className="bo-pl__label" htmlFor="wz-otp">
            Minutos hasta que vence
          </label>
          <input
            id="wz-otp"
            className="bo-pl__input"
            type="number"
            min={1}
            max={90}
            value={form.codeExpirationMinutes}
            disabled={saving}
            onChange={(e) => set('codeExpirationMinutes', e.target.value)}
          />
          <span className="bo-pl__hint">
            Entre 1 y 90. META agrega la frase del vencimiento al pie del mensaje.
          </span>
        </div>
      )}
    </>
  );
}

/**
 * Último paso — qué se va a enviar y qué falta.
 *
 * El JSON de META se pide al servidor y no se arma acá: lo genera WABA con el mismo
 * código del envío real, así lo que se muestra es exactamente lo que viaja. Reconstruirlo
 * en el front sería una segunda versión que puede desincronizarse en silencio.
 */
function PasoRevision({ form, errores }: { form: TemplateFormState; errores: string[] }) {
  const [abierto, setAbierto] = useState(false);
  const [payload, setPayload] = useState<unknown>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Se vuelve a pedir si el formulario cambió mientras estaba abierto: un JSON viejo
  // sería peor que ninguno, porque lo que responde es qué se va a enviar.
  useEffect(() => {
    if (!abierto) return;
    let vigente = true;

    setCargando(true);
    setError(null);
    validateTemplate(aPayload(form))
      .then((res) => {
        if (!vigente) return;
        setPayload(res.payload);
        setError(res.payloadError);
      })
      .catch((err) => vigente && setError(mensajesDeError(err)[0]))
      .finally(() => vigente && setCargando(false));

    return () => {
      vigente = false;
    };
  }, [abierto, form]);

  return (
    <>
      <h3 className="bo-pl__steptitle">Revisá antes de enviar</h3>

      {errores.length > 0 ? (
        <div className="bo-pl__warn">
          <strong>Hay que corregir esto:</strong>
          <ul className="bo-pl__errlist">
            {errores.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="bo-pl__hint">
          Verificamos que cumpla las reglas de META para evitarte un rechazo. Está todo en
          orden.
        </p>
      )}

      <dl className="bo-pl__review">
        <dt>Título</dt>
        <dd>{form.friendlyTitle || '—'}</dd>
        <dt>Nombre técnico</dt>
        <dd className="bo-pl__name">{form.name || '—'}</dd>
        <dt>Objetivo</dt>
        <dd>
          {form.category === 'MARKETING' && 'Promocionar o dar novedades'}
          {form.category === 'UTILITY' && 'Avisar algo a un cliente'}
          {form.category === 'AUTHENTICATION' && 'Enviar un código de verificación'}
        </dd>
        <dt>Idioma</dt>
        <dd>{form.language}</dd>
        {form.headerHandle && (
          <>
            <dt>Archivo de ejemplo</dt>
            <dd>{form.headerFileName || 'Cargado'}</dd>
          </>
        )}
        {form.variables.length > 0 && (
          <>
            <dt>Datos variables</dt>
            <dd>
              {form.variables
                .map((v) => `{{${v.index}}}${v.label ? ` (${v.label})` : ''} → ${v.example || 'sin ejemplo'}`)
                .join(' · ')}
            </dd>
          </>
        )}
      </dl>

      <JsonBox
        titulo="Ver el JSON que se envía a META"
        valor={payload}
        cargando={cargando}
        error={error}
        onOpenChange={setAbierto}
        hint="Es el payload exacto que recibe META. Sirve para entender un rechazo, que suele venir escrito en estos términos."
      />

      <p className="bo-pl__notice">
        Al enviarla queda <strong>en revisión de META</strong>. Hasta que la aprueben no se
        puede usar, y pueden rechazarla.
      </p>
    </>
  );
}
