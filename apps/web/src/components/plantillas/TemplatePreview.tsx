import { Template } from './plantillas.types';
import { buttonLabel, headerLabel } from './plantillas.format';

/**
 * Cómo se ve la plantilla en el teléfono.
 *
 * Es lo que hace útil la pantalla: los campos sueltos (`HeaderContent`, `BodyText`,
 * `FooterText`, `ButtonsJson`) no dejan ver el mensaje que le llega al cliente. Acá se
 * arma la burbuja, con las variables resaltadas.
 */

/** Parte el texto en fragmentos y variables, para poder resaltar los `{{...}}`. */
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

function Body({ text }: { text: string }) {
  return (
    <>
      {splitVariables(text).map((parte, i) =>
        parte.isVar ? (
          <span key={i} className="bo-pl__var" title="Variable: se completa al enviar">
            {parte.text}
          </span>
        ) : (
          <span key={i}>{parte.text}</span>
        ),
      )}
    </>
  );
}

export function TemplatePreview({ template }: { template: Template }) {
  const header = headerLabel(template.headerType);

  return (
    <div className="bo-pl__preview">
      <div className="bo-pl__bubble">
        {header && (
          <div className="bo-pl__header">
            {template.headerType === 'TEXT' && template.headerContent ? (
              <Body text={template.headerContent} />
            ) : (
              <span className="bo-pl__headermedia">{header}</span>
            )}
          </div>
        )}

        <div className="bo-pl__body">
          {template.bodyText ? (
            <Body text={template.bodyText} />
          ) : (
            <span className="bo-pl__empty">Sin texto</span>
          )}
        </div>

        {template.footerText && <div className="bo-pl__footer">{template.footerText}</div>}
      </div>

      {template.buttons.length > 0 && (
        <ul className="bo-pl__buttons">
          {template.buttons.map((b, i) => (
            <li key={i} className="bo-pl__button">
              {buttonLabel(b)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
