import { Fragment, ReactNode } from 'react';
import { Template } from './plantillas.types';
import { buttonLabel, headerLabel } from './plantillas.format';

/**
 * Cómo se ve la plantilla en el teléfono.
 *
 * Es lo que hace útil la pantalla: los campos sueltos que devuelve WABA (`HeaderContent`,
 * `BodyText`, `FooterText`, `ButtonsJson`) no dejan ver el mensaje que le llega al
 * cliente. Acá se arma la burbuja como la dibuja WhatsApp — sobre el fondo del chat, con
 * la hora y el doble tilde, y los botones apilados afuera.
 *
 * Es una **aproximación**: el diseño final lo define WhatsApp y cambia entre versiones.
 * Sirve para ver el texto en contexto y notar un mensaje demasiado largo o una variable
 * en el lugar equivocado, no para validar píxeles.
 */

/** Parte el texto en fragmentos y variables, para poder resaltar los `{{n}}`. */
function splitVariables(text: string): { text: string; isVar: boolean }[] {
  const out: { text: string; isVar: boolean }[] = [];
  const re = /\{\{\s*[^}\s][^}]*?\s*\}\}/g;
  let last = 0;

  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), isVar: false });
    out.push({ text: m[0], isVar: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), isVar: false });
  return out;
}

/**
 * Formato de WhatsApp: `*negrita*`, `_cursiva_`, `~tachado~`.
 *
 * Se aplica acá porque en el mensaje real WhatsApp lo interpreta: sin esto, un texto con
 * asteriscos se ve distinto en la vista previa que en el teléfono.
 */
function aplicarFormato(texto: string): ReactNode[] {
  const partes: ReactNode[] = [];
  const re = /(\*[^*\n]+\*)|(_[^_\n]+_)|(~[^~\n]+~)/g;
  let last = 0;
  let key = 0;

  for (const m of texto.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) partes.push(texto.slice(last, i));
    const t = m[0];
    const interior = t.slice(1, -1);
    if (t.startsWith('*')) partes.push(<strong key={key++}>{interior}</strong>);
    else if (t.startsWith('_')) partes.push(<em key={key++}>{interior}</em>);
    else partes.push(<s key={key++}>{interior}</s>);
    last = i + t.length;
  }
  if (last < texto.length) partes.push(texto.slice(last));
  return partes;
}

function Texto({ text }: { text: string }) {
  return (
    <>
      {splitVariables(text).map((parte, i) =>
        parte.isVar ? (
          <span key={i} className="bo-pl__var" title="Variable: se completa al enviar">
            {parte.text}
          </span>
        ) : (
          <Fragment key={i}>{aplicarFormato(parte.text)}</Fragment>
        ),
      )}
    </>
  );
}

/** Hueco del multimedia: la plantilla define el espacio, no el archivo. */
function HeaderMedia({ tipo }: { tipo: string }) {
  const icono = tipo === 'IMAGE' ? '▣' : tipo === 'VIDEO' ? '▶' : tipo === 'LOCATION' ? '◎' : '▤';

  return (
    <div className="bo-pl__media">
      <span className="bo-pl__mediaicon" aria-hidden="true">
        {icono}
      </span>
      <span className="bo-pl__headermedia">{headerLabel(tipo)}</span>
    </div>
  );
}

export function TemplatePreview({ template }: { template: Template }) {
  const header = headerLabel(template.headerType);
  const esMedia = header !== null && template.headerType !== 'TEXT';

  return (
    <div className="bo-pl__preview">
      <div className="bo-pl__chat">
        <div className="bo-pl__bubble">
          {esMedia && <HeaderMedia tipo={template.headerType as string} />}

          {header !== null && template.headerType === 'TEXT' && template.headerContent && (
            <div className="bo-pl__header">
              <Texto text={template.headerContent} />
            </div>
          )}

          <div className="bo-pl__body">
            {template.bodyText ? (
              <Texto text={template.bodyText} />
            ) : (
              <span className="bo-pl__notext">Sin texto</span>
            )}
          </div>

          {template.footerText && <div className="bo-pl__footer">{template.footerText}</div>}

          {/* Hora fija: una hora real cambiaría en cada render y distraería del contenido. */}
          <div className="bo-pl__meta">
            <span className="bo-pl__time">10:30</span>
            <span className="bo-pl__ticks" aria-hidden="true" title="Entregado">
              ✓✓
            </span>
          </div>
        </div>

        {/* WhatsApp dibuja los botones fuera de la burbuja, apilados. */}
        {template.buttons.length > 0 && (
          <ul className="bo-pl__buttons">
            {template.buttons.map((b, i) => (
              <li key={i} className="bo-pl__button">
                <span className="bo-pl__buttonicon" aria-hidden="true">
                  {b.type === 'URL' ? '↗' : b.type === 'PHONE_NUMBER' ? '✆' : '↩'}
                </span>
                <span className="bo-pl__buttonlabel">{buttonLabel(b)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
