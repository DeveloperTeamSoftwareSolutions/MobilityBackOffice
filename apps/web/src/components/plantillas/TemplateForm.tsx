import { useEffect, useMemo, useState } from 'react';
import {
  EditPolicy,
  Template,
  TemplateButton,
  TemplateDraft,
  TemplateFormState,
} from './plantillas.types';
import { aPayload, mensajesDeError, validateTemplate } from './plantillas.api';
import { EditPolicyNotice } from './EditPolicyNotice';
import { HeaderMediaUpload } from './HeaderMediaUpload';
import { JsonBox } from './JsonBox';
import { LIMITS, validateForm, variableNumbers } from './plantillas.validate';
import { TemplatePreview } from './TemplatePreview';

/**
 * Alta y edición de una plantilla.
 *
 * Tres cosas que la pantalla tiene que dejar claras, porque no son obvias y cada una
 * cuesta un ciclo de revisión de META si se descubren tarde:
 *
 * 1. **Crear no es guardar.** La plantilla se envía a META y queda "En revisión". El
 *    estado lo decide META, puede tardar, y puede rechazarla.
 * 2. **El nombre y el idioma no se cambian nunca.** META los toma como identidad, así
 *    que al editar están bloqueados.
 * 3. **AUTHENTICATION es otra cosa.** Ahí META escribe el texto: no hay mensaje, ni
 *    encabezado, ni botones que configurar.
 */

const CATEGORIAS = [
  { value: 'MARKETING', label: 'Marketing', hint: 'Promociones, novedades, saludos' },
  { value: 'UTILITY', label: 'Utilidad', hint: 'Avisos sobre algo que el cliente ya pidió' },
  { value: 'AUTHENTICATION', label: 'Autenticación', hint: 'Códigos de verificación (OTP)' },
];

const IDIOMAS = [
  { value: 'es_MX', label: 'Español (MX)' },
  { value: 'es_ES', label: 'Español (ES)' },
  { value: 'es', label: 'Español' },
  { value: 'en_US', label: 'Inglés (US)' },
  { value: 'pt_BR', label: 'Portugués (BR)' },
];

const HEADERS = [
  { value: 'NONE', label: 'Sin encabezado' },
  { value: 'TEXT', label: 'Texto' },
  { value: 'IMAGE', label: 'Imagen' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'DOCUMENT', label: 'Documento' },
];

const TIPOS_BOTON = [
  { value: 'QUICK_REPLY', label: 'Respuesta rápida' },
  { value: 'URL', label: 'Abrir un enlace' },
  { value: 'PHONE_NUMBER', label: 'Llamar' },
];

export function estadoInicial(template?: Template | null): TemplateFormState {
  return {
    // Al editar se completa desde el nombre tecnico: sin titulo, el asistente se traba
    // en el paso del nombre pidiendo algo que en una plantilla existente ya esta decidido.
    friendlyTitle: template ? tituloDesdeNombre(template.name) : '',
    name: template?.name ?? '',
    language: template?.language ?? 'es_MX',
    category: template?.category ?? 'MARKETING',
    headerType: template?.headerType ?? 'NONE',
    headerContent: template?.headerContent ?? '',
    // El handle vive solo mientras se arma: el archivo ya subido no vuelve a viajar.
    headerHandle: '',
    headerFileName: '',
    bodyText: template?.bodyText ?? '',
    footerText: template?.footerText ?? '',
    buttons: template?.buttons ? template.buttons.map((b) => ({ ...b })) : [],
    addSecurityRecommendation: false,
    codeExpirationMinutes: '',
    otpType: 'COPY_CODE',
    variables: [],
  };
}

/**
 * El formulario, tal como quedó el borrador.
 *
 * Es la diferencia entre "seguir mañana" y "empezar de nuevo". Reabrir por el detalle de
 * la plantilla pierde tres cosas que no se ven hasta que hacen falta:
 *
 * - el **título** amigable, que no viaja a META y por eso no está en el detalle;
 * - el **archivo** del encabezado — está en META y su referencia guardada, pero el
 *   detalle la devuelve en otro campo que el formulario ignora;
 * - el **nombre y el ejemplo de cada variable**. El detalle solo trae los números, y META
 *   exige los ejemplos: sin ellos hay que reescribirlos todos.
 */
export function estadoDesdeBorrador(draft: TemplateDraft): TemplateFormState {
  return {
    friendlyTitle: draft.friendlyTitle || tituloDesdeNombre(draft.name),
    name: draft.name,
    language: draft.language,
    category: draft.category,
    headerType: draft.headerType,
    headerContent: draft.headerContent ?? '',
    headerHandle: draft.headerHandle ?? '',
    // El nombre del archivo no se guarda: solo servía para mostrarlo mientras se subía.
    headerFileName: '',
    bodyText: draft.bodyText ?? '',
    footerText: draft.footerText ?? '',
    buttons: draft.buttons.map((b) => ({ ...b })),
    addSecurityRecommendation: draft.addSecurityRecommendation,
    // El formulario los maneja como texto: vacío es "no vence".
    codeExpirationMinutes:
      draft.codeExpirationMinutes === null ? '' : String(draft.codeExpirationMinutes),
    otpType: draft.otpType,
    variables: draft.variables.map((v) => ({ ...v })),
  };
}

/**
 * `promo_navidad_2026` -> `Promo navidad 2026`.
 *
 * El titulo amigable no se guarda en META, asi que al editar no existe. Se reconstruye
 * del nombre tecnico, que es lo mas cerca que hay de como la llama la gente.
 */
function tituloDesdeNombre(nombre: string): string {
  const limpio = (nombre || '').replace(/_+/g, ' ').trim();
  if (!limpio) return '';
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/** El estado del formulario, visto como plantilla, para la vista previa en vivo. */
function comoPlantilla(form: TemplateFormState): Template {
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
    variables: variableNumbers(form.bodyText).map(String),
  };
}

export function TemplateForm({
  template,
  editPolicy,
  form,
  setForm,
  onCancel,
  onSubmit,
  onWizard,
  saving,
  serverErrors,
  onSaveDraft,
  savingDraft,
  draftNotice,
}: {
  /** `null` = alta. Con plantilla = edición. */
  template: Template | null;
  editPolicy: EditPolicy | null;
  /** El estado vive en el contenedor: así alternar de modo no pierde nada. */
  form: TemplateFormState;
  setForm: (f: TemplateFormState | ((f: TemplateFormState) => TemplateFormState)) => void;
  onCancel: () => void;
  onSubmit: () => void;
  /** Volver al asistente. `null` en edición: ahí el asistente no aplica. */
  onWizard: (() => void) | null;
  saving: boolean;
  /** Errores que devolvió el servidor (validación de WABA o rechazo de META). */
  serverErrors: string[];
  /** Guardar el avance sin enviar. `null` en edición: lo que ya existe en META no es borrador. */
  onSaveDraft: (() => void) | null;
  savingDraft: boolean;
  draftNotice: string | null;
}) {
  const esEdicion = template !== null;
  // Un borrador nunca estuvo en revisión: no se "reenvía", se envía por primera vez.
  const esBorrador = template?.status === 'DRAFT';
  const [intentado, setIntentado] = useState(false);

  const errores = useMemo(() => validateForm(form, esEdicion), [form, esEdicion]);
  const esAuth = form.category === 'AUTHENTICATION';
  const bloqueado = esEdicion && editPolicy ? editPolicy.canEdit === false : false;

  const set = <K extends keyof TemplateFormState>(key: K, value: TemplateFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setButton = (i: number, patch: Partial<TemplateButton>) =>
    setForm((f) => ({
      ...f,
      buttons: f.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    }));

  const addButton = () =>
    setForm((f) => ({
      ...f,
      buttons: [...f.buttons, { type: 'QUICK_REPLY', text: '', url: null, phoneNumber: null }],
    }));

  const removeButton = (i: number) =>
    setForm((f) => ({ ...f, buttons: f.buttons.filter((_, j) => j !== i) }));

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    setIntentado(true);
    if (errores.length > 0) return;
    onSubmit();
  };

  return (
    <form className="bo-pl__form" onSubmit={enviar} noValidate>
      <div className="bo-pl__formhead">
        <h2 className="bo-pl__formtitle">
          {esEdicion ? `Editar ${template.name}` : 'Nueva plantilla — modo avanzado'}
        </h2>
        <p className="bo-pl__formsub">
          {esBorrador
            ? 'Es un borrador: todavía no se envió a META. Podés seguir guardándolo así.'
            : esEdicion
              ? 'Al guardar, la plantilla vuelve a revisión de META.'
              : 'La plantilla se envía a META para aprobación. No se puede usar hasta que la aprueben.'}
        </p>
      </div>

      <EditPolicyNotice policy={esEdicion ? editPolicy : null} />

      {serverErrors.length > 0 && (
        <div className="bo-pl__warn">
          <strong>No se pudo guardar:</strong>
          <ul className="bo-pl__errlist">
            {serverErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {intentado && errores.length > 0 && (
        <div className="bo-pl__warn">
          <strong>Revisá esto antes de enviar:</strong>
          <ul className="bo-pl__errlist">
            {errores.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="bo-pl__formgrid">
        <div className="bo-pl__formcol">
          {/* ---- Identidad ---- */}
          <div className="bo-pl__field">
            <label className="bo-pl__label" htmlFor="pl-name">
              Nombre
            </label>
            <input
              id="pl-name"
              className="bo-pl__input"
              value={form.name}
              disabled={esEdicion || saving}
              maxLength={LIMITS.NAME_MAX}
              onChange={(e) => set('name', e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              placeholder="saludo_navidad"
            />
            <span className="bo-pl__hint">
              {esEdicion
                ? 'El nombre no se puede cambiar: META lo usa para identificar la plantilla.'
                : 'Solo minúsculas, números y guión bajo. Los espacios se convierten en _.'}
            </span>
          </div>

          <div className="bo-pl__field">
            <label className="bo-pl__label" htmlFor="pl-lang">
              Idioma
            </label>
            <select
              id="pl-lang"
              className="bo-pl__input"
              value={form.language}
              disabled={esEdicion || saving}
              onChange={(e) => set('language', e.target.value)}
            >
              {IDIOMAS.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
            {esEdicion && <span className="bo-pl__hint">Tampoco se puede cambiar.</span>}
          </div>

          <div className="bo-pl__field">
            <label className="bo-pl__label" htmlFor="pl-cat">
              Categoría
            </label>
            <select
              id="pl-cat"
              className="bo-pl__input"
              value={form.category}
              disabled={saving}
              onChange={(e) => set('category', e.target.value)}
            >
              {CATEGORIAS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="bo-pl__hint">
              {CATEGORIAS.find((c) => c.value === form.category)?.hint}
            </span>
          </div>

          {esAuth ? (
            <AuthFields form={form} set={set} saving={saving} />
          ) : (
            <ContentFields
              form={form}
              set={set}
              saving={saving}
              buttons={{ setButton, addButton, removeButton }}
            />
          )}
        </div>

        {/* ---- Vista previa en vivo ---- */}
        <div className="bo-pl__formcol">
          <span className="bo-pl__label">Vista previa</span>
          {esAuth ? (
            <p className="bo-pl__hint">
              META escribe el texto de las plantillas de autenticación y lo traduce a cada
              idioma. No hay vista previa acá: se ve una vez aprobada.
            </p>
          ) : (
            <TemplatePreview template={comoPlantilla(form)} ejemplos={form.variables} />
          )}
        </div>
      </div>

      <PayloadBox form={form} />


      <div className="bo-pl__formactions">
        {onWizard && (
          <button type="button" className="bo-pl__btn" onClick={onWizard} disabled={saving}>
            Volver al asistente
          </button>
        )}
        {/* Guardar sin enviar: una plantilla se arma en varias sesiones. */}
        {onSaveDraft && (
          <>
            <button
              type="button"
              className="bo-pl__btn"
              onClick={onSaveDraft}
              disabled={saving || savingDraft}
            >
              {savingDraft ? 'Guardando…' : 'Guardar borrador'}
            </button>
            {/* Al lado del boton: es la respuesta a ese clic, no un aviso de la pantalla. */}
            {draftNotice && <span className="bo-pl__draftnotice">{draftNotice}</span>}
          </>
        )}
        <span className="bo-pl__spacer" />
        <button type="button" className="bo-pl__btn" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button
          type="submit"
          className="bo-pl__btn bo-pl__btn--primary"
          disabled={saving || bloqueado}
        >
          {saving
            ? 'Enviando…'
            : esEdicion && !esBorrador
              ? 'Guardar y reenviar a revisión'
              : 'Enviar a revisión de META'}
        </button>
      </div>
    </form>
  );
}

/**
 * El JSON que se le mandaría a META, pedido al servidor.
 *
 * No se arma en el front: lo genera WABA con el mismo código del envío real, así lo que
 * se muestra es exactamente lo que viaja. Una segunda versión acá podría desincronizarse
 * en silencio y mostrar algo que no es.
 */
function PayloadBox({ form }: { form: TemplateFormState }) {
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
    <JsonBox
      titulo="Ver el JSON que se envía a META"
      valor={payload}
      cargando={cargando}
      error={error}
      onOpenChange={setAbierto}
      hint="Es el payload exacto que recibe META. Sirve para entender un rechazo, que suele venir escrito en estos términos."
    />
  );
}

/** Campos de MARKETING y UTILITY: encabezado, mensaje, pie y botones. */
function ContentFields({
  form,
  set,
  saving,
  buttons,
}: {
  form: TemplateFormState;
  set: <K extends keyof TemplateFormState>(k: K, v: TemplateFormState[K]) => void;
  saving: boolean;
  buttons: {
    setButton: (i: number, patch: Partial<TemplateButton>) => void;
    addButton: () => void;
    removeButton: (i: number) => void;
  };
}) {
  return (
    <>
      <div className="bo-pl__field">
        <label className="bo-pl__label" htmlFor="pl-header">
          Encabezado
        </label>
        <select
          id="pl-header"
          className="bo-pl__input"
          value={form.headerType}
          disabled={saving}
          onChange={(e) => set('headerType', e.target.value)}
        >
          {HEADERS.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </select>
      </div>

      {form.headerType === 'TEXT' && (
        <div className="bo-pl__field">
          <label className="bo-pl__label" htmlFor="pl-headertext">
            Texto del encabezado
          </label>
          <input
            id="pl-headertext"
            className="bo-pl__input"
            value={form.headerContent}
            disabled={saving}
            maxLength={LIMITS.HEADER_TEXT_MAX}
            onChange={(e) => set('headerContent', e.target.value)}
          />
          <span className="bo-pl__hint">
            {form.headerContent.length}/{LIMITS.HEADER_TEXT_MAX} · admite una sola variable
          </span>
        </div>
      )}

      {form.headerType !== 'NONE' && form.headerType !== 'TEXT' && (
        <>
          <p className="bo-pl__hint">
            El archivo que se manda a cada cliente lo elige quien envía el mensaje. Acá se
            define que la plantilla lleva un encabezado de este tipo, y se sube un ejemplo
            para que META pueda revisarla.
          </p>
          <HeaderMediaUpload form={form} set={set} saving={saving} id="pl-headerfile" />
        </>
      )}

      <div className="bo-pl__field">
        <label className="bo-pl__label" htmlFor="pl-body">
          Mensaje
        </label>
        <textarea
          id="pl-body"
          className="bo-pl__textarea"
          rows={6}
          value={form.bodyText}
          disabled={saving}
          maxLength={LIMITS.BODY_MAX}
          onChange={(e) => set('bodyText', e.target.value)}
          placeholder="Hola {{1}}, te escribimos para…"
        />
        <span className="bo-pl__hint">
          {form.bodyText.length}/{LIMITS.BODY_MAX} · usá <code>{'{{1}}'}</code>,{' '}
          <code>{'{{2}}'}</code>… para lo que cambia en cada envío. Deben ir en orden y sin
          saltos.
        </span>
      </div>

      <div className="bo-pl__field">
        <label className="bo-pl__label" htmlFor="pl-footer">
          Pie <span className="bo-pl__opt">(opcional)</span>
        </label>
        <input
          id="pl-footer"
          className="bo-pl__input"
          value={form.footerText}
          disabled={saving}
          maxLength={LIMITS.FOOTER_MAX}
          onChange={(e) => set('footerText', e.target.value)}
        />
        <span className="bo-pl__hint">
          {form.footerText.length}/{LIMITS.FOOTER_MAX} · no admite variables
        </span>
      </div>

      <div className="bo-pl__field">
        <span className="bo-pl__label">
          Botones <span className="bo-pl__opt">(opcional)</span>
        </span>

        {form.buttons.map((b, i) => (
          <div key={i} className="bo-pl__btnrow">
            <select
              className="bo-pl__input bo-pl__input--sm"
              value={b.type ?? 'QUICK_REPLY'}
              disabled={saving}
              aria-label={`Tipo del botón ${i + 1}`}
              onChange={(e) =>
                buttons.setButton(i, { type: e.target.value, url: null, phoneNumber: null })
              }
            >
              {TIPOS_BOTON.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>

            <input
              className="bo-pl__input bo-pl__input--sm"
              value={b.text ?? ''}
              disabled={saving}
              maxLength={LIMITS.BUTTON_TEXT_MAX}
              placeholder="Texto del botón"
              aria-label={`Texto del botón ${i + 1}`}
              onChange={(e) => buttons.setButton(i, { text: e.target.value })}
            />

            {b.type === 'URL' && (
              <input
                className="bo-pl__input bo-pl__input--sm"
                value={b.url ?? ''}
                disabled={saving}
                placeholder="https://…"
                aria-label={`Enlace del botón ${i + 1}`}
                onChange={(e) => buttons.setButton(i, { url: e.target.value })}
              />
            )}

            {b.type === 'PHONE_NUMBER' && (
              <input
                className="bo-pl__input bo-pl__input--sm"
                value={b.phoneNumber ?? ''}
                disabled={saving}
                placeholder="+502…"
                aria-label={`Teléfono del botón ${i + 1}`}
                onChange={(e) => buttons.setButton(i, { phoneNumber: e.target.value })}
              />
            )}

            <button
              type="button"
              className="bo-pl__btn bo-pl__btn--sm"
              disabled={saving}
              onClick={() => buttons.removeButton(i)}
            >
              Quitar
            </button>
          </div>
        ))}

        <button
          type="button"
          className="bo-pl__btn bo-pl__btn--sm"
          disabled={saving}
          onClick={buttons.addButton}
        >
          Agregar botón
        </button>
        <span className="bo-pl__hint">
          Hasta {LIMITS.MAX_QUICK_REPLY} de respuesta rápida, {LIMITS.MAX_URL_BUTTONS} de
          enlace y {LIMITS.MAX_PHONE_BUTTONS} de llamada.
        </span>

        {form.buttons.length > 0 && (
          <JsonBox
            titulo="Ver el JSON de los botones"
            valor={form.buttons}
            hint="Es como viajan los botones dentro de la plantilla. Útil para pegárselo a quien integra, o para comparar contra lo que devuelve META."
          />
        )}
      </div>
    </>
  );
}

/** Campos de AUTHENTICATION. META escribe el texto: solo se configuran opciones. */
function AuthFields({
  form,
  set,
  saving,
}: {
  form: TemplateFormState;
  set: <K extends keyof TemplateFormState>(k: K, v: TemplateFormState[K]) => void;
  saving: boolean;
}) {
  return (
    <>
      <p className="bo-pl__notice">
        En las plantillas de autenticación <strong>el texto lo escribe META</strong> y lo
        traduce a cada idioma. Acá solo se configuran las opciones del código.
      </p>

      <div className="bo-pl__field">
        <label className="bo-pl__check">
          <input
            type="checkbox"
            checked={form.addSecurityRecommendation}
            disabled={saving}
            onChange={(e) => set('addSecurityRecommendation', e.target.checked)}
          />
          <span>Agregar la advertencia de no compartir el código</span>
        </label>
      </div>

      <div className="bo-pl__field">
        <label className="bo-pl__label" htmlFor="pl-otp-exp">
          Validez del código <span className="bo-pl__opt">(opcional)</span>
        </label>
        <input
          id="pl-otp-exp"
          className="bo-pl__input"
          type="number"
          min={LIMITS.OTP_MIN}
          max={LIMITS.OTP_MAX}
          value={form.codeExpirationMinutes}
          disabled={saving}
          onChange={(e) => set('codeExpirationMinutes', e.target.value)}
          placeholder="10"
        />
        <span className="bo-pl__hint">
          En minutos, entre {LIMITS.OTP_MIN} y {LIMITS.OTP_MAX}. Si lo dejás vacío, el
          mensaje no menciona vencimiento.
        </span>
      </div>

      <div className="bo-pl__field">
        <span className="bo-pl__label">Botón</span>
        <p className="bo-pl__hint">
          Se agrega un botón para copiar el código. Es el único tipo disponible: los otros
          exigen datos de una app Android.
        </p>
      </div>
    </>
  );
}
