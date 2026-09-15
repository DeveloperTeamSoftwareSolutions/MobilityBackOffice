import { Fragment, ReactNode } from 'react';
import { Template, TemplateVariable } from './plantillas.types';
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

/**
 * Un `{{n}}` reemplazado por su ejemplo, o el `{{n}}` crudo si todavia no hay ninguno.
 *
 * Se reemplaza porque la pregunta que responde la vista previa es **como le llega el
 * mensaje al cliente**, y al cliente no le llega "{{1}}": le llega un nombre. Igual se
 * resalta, para que se vea que ese pedazo cambia en cada envio y no es texto fijo.
 */
function variableAMostrar(
  crudo: string,
  target: Objetivo,
  ejemplos: TemplateVariable[],
): { texto: string; esEjemplo: boolean } {
  const n = Number(crudo.replace(/[^0-9]/g, ''));
  const v = ejemplos.find((e) => e.index === n && e.target === target);
  const ejemplo = v ? v.example.trim() : '';
  return ejemplo ? { texto: ejemplo, esEjemplo: true } : { texto: crudo, esEjemplo: false };
}

/** Encabezado y cuerpo numeran aparte en META, asi que el ejemplo depende de donde va. */
type Objetivo = 'body' | 'header';

function Texto({
  text,
  target,
  ejemplos,
}: {
  text: string;
  target: Objetivo;
  ejemplos: TemplateVariable[];
}) {
  return (
    <>
      {splitVariables(text).map((parte, i) => {
        if (!parte.isVar) {
          return <Fragment key={i}>{aplicarFormato(parte.text)}</Fragment>;
        }
        const { texto, esEjemplo } = variableAMostrar(parte.text, target, ejemplos);
        return (
          <span
            key={i}
            className="bo-pl__var"
            title={
              esEjemplo
                ? 'Es un ejemplo: al enviar se reemplaza por el dato real'
                : 'Variable: se completa al enviar'
            }
          >
            {texto}
          </span>
        );
      })}
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

export function TemplatePreview({
  template,
  ejemplos = [],
}: {
  template: Template;
  /**
   * Nombre y ejemplo de cada variable, para mostrar el mensaje **como le llega al
   * cliente** en vez de con los `{{n}}` crudos. Vacio en la lista, donde solo se tiene
   * lo que devuelve WABA.
   */
  ejemplos?: TemplateVariable[];
}) {
  const header = headerLabel(template.headerType);
  const esMedia = header !== null && template.headerType !== 'TEXT';

  return (
    <div className="bo-pl__preview">
      <div className="bo-pl__chat">
        <div className="bo-pl__bubble">
          {esMedia && <HeaderMedia tipo={template.headerType as string} />}

          {header !== null && template.headerType === 'TEXT' && template.headerContent && (
            <div className="bo-pl__header">
              <Texto text={template.headerContent} target="header" ejemplos={ejemplos} />
            </div>
          )}

          <div className="bo-pl__body">
            {template.bodyText ? (
              <Texto text={template.bodyText} target="body" ejemplos={ejemplos} />
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
