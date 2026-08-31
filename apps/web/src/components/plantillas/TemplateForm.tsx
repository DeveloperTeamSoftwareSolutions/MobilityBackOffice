import { useMemo, useState } from 'react';
import {
  EditPolicy,
  Template,
  TemplateButton,
  TemplateFormState,
} from './plantillas.types';
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
    name: template?.name ?? '',
    language: template?.language ?? 'es_MX',
    category: template?.category ?? 'MARKETING',
    headerType: template?.headerType ?? 'NONE',
    headerContent: template?.headerContent ?? '',
    bodyText: template?.bodyText ?? '',
    footerText: template?.footerText ?? '',
    buttons: template?.buttons ? template.buttons.map((b) => ({ ...b })) : [],
    addSecurityRecommendation: false,
    codeExpirationMinutes: '',
    otpType: 'COPY_CODE',
  };
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
  /** Errores que devolvió el servidor (validación de WABA o rechazo de META). */
  serverErrors: string[];
}) {
  const esEdicion = template !== null;
  const [form, setForm] = useState<TemplateFormState>(() => estadoInicial(template));
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
    onSubmit(form);
  };

  return (
    <form className="bo-pl__form" onSubmit={enviar} noValidate>
      <div className="bo-pl__formhead">
        <h2 className="bo-pl__formtitle">
          {esEdicion ? `Editar ${template.name}` : 'Nueva plantilla'}
        </h2>
        <p className="bo-pl__formsub">
          {esEdicion
            ? 'Al guardar, la plantilla vuelve a revisión de META.'
            : 'La plantilla se envía a META para aprobación. No se puede usar hasta que la aprueben.'}
        </p>
      </div>

      {bloqueado && (
        <p className="bo-pl__warn">
          <strong>Esta plantilla no se puede editar ahora.</strong>{' '}
          {editPolicy?.reason ?? 'META tiene una revisión en curso.'}
        </p>
      )}

      {editPolicy?.warnings?.length ? (
        <p className="bo-pl__notice">
          {editPolicy.warnings.join(' · ')}
        </p>
      ) : null}

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
            <TemplatePreview template={comoPlantilla(form)} />
          )}
        </div>
      </div>

      <div className="bo-pl__formactions">
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
            : esEdicion
              ? 'Guardar y reenviar a revisión'
              : 'Enviar a revisión de META'}
        </button>
      </div>
    </form>
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
        <p className="bo-pl__hint">
          El archivo lo elige quien envía el mensaje. Acá solo se define que la plantilla
          lleva un encabezado de este tipo.
        </p>
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
