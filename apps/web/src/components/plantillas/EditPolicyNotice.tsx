import { EditPolicy } from './plantillas.types';

/**
 * Lo que META permite hacer con esta plantilla ahora mismo.
 *
 * Las reglas son de META y las evalua WABA; acá solo se muestran. Importa decirlas
 * **antes** de que alguien escriba: una plantilla en revisión no acepta cambios, y
 * enterarse al guardar significa haber completado un formulario para nada.
 *
 * Los números del cupo son **orientativos**: no están en la documentación de META y el
 * conteo es propio, así que alguien que edite desde el Business Manager de Meta lo deja
 * desactualizado. Por eso se avisan y nunca bloquean.
 */
export function EditPolicyNotice({ policy }: { policy: EditPolicy | null }) {
  if (!policy) return null;

  const cooldown = formatearEspera(policy.cooldownUntil);
  const hayCupo = policy.limited && policy.remaining !== null;

  if (!policy.canEdit) {
    return (
      <div className="bo-pl__warn">
        <strong>Todavía no se puede editar.</strong>{' '}
        {policy.reason ?? 'META no permite editar esta plantilla en este momento.'}
      </div>
    );
  }

  if (policy.warnings.length === 0 && !hayCupo) return null;

  return (
    <div className="bo-pl__notice">
      {policy.warnings.length > 0 && (
        <ul className="bo-pl__errlist">
          {policy.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {hayCupo && (
        <p className="bo-pl__quota">
          <strong>Ediciones restantes: {policy.remaining}</strong> de 10 este mes
          {policy.used > 0 && ` (usaste ${policy.used})`}
          {cooldown && ` · se puede volver a editar ${cooldown}`}.
          <span className="bo-pl__hint">
            Es un conteo propio y orientativo: si alguien edita la plantilla desde el
            Business Manager de Meta, este número puede no coincidir.
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * La espera de 24 h, en palabras.
 *
 * Una fecha ISO no le dice nada a quien está por editar; lo que necesita saber es
 * cuánto falta.
 */
function formatearEspera(cooldownUntil: string | null): string | null {
  if (!cooldownUntil) return null;

  const hasta = new Date(cooldownUntil);
  if (Number.isNaN(hasta.getTime())) return null;

  const faltanMs = hasta.getTime() - Date.now();
  if (faltanMs <= 0) return null;

  const horas = Math.ceil(faltanMs / (60 * 60 * 1000));
  if (horas <= 1) return 'en menos de una hora';
  return `en ${horas} horas`;
}
