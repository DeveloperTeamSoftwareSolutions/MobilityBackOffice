import { BlockedReason, EffectiveBand } from './authorizers.types';

/**
 * Interpreta la banda de firma de un autorizador.
 *
 * POR QUE ESTA FUNCION EXISTE ACA. La regla es del middleware
 * (`src/utils/approverLimits.js`), que es quien la aplica cuando un gerente decide. Pero
 * la vista `VIEW_AuthorizerLimitsProfitCentersMobility` devuelve los porcentajes CRUDOS
 * y no hay endpoint que publique la lectura ya hecha. Si esta pantalla volcara los
 * numeros tal cual, mentiria: mostraria "0% - 0%" donde la verdad es "este gerente no
 * puede firmar nada", y "200% - 200%" donde la verdad es "firma cualquier descuento".
 *
 * Es una REPLICA, no la fuente. Si el middleware cambia la semantica, esto queda viejo
 * en silencio — por eso los casos limite estan fijados en `authorizers.band.spec.ts`
 * con los mismos valores que el middleware documenta.
 *
 * SEMANTICA (directiva del usuario 2026-08-18, ver `approverLimits.js`):
 *   Min/MaximumPercentage son una banda de DESCUENTO [Min, Max]. El autorizador solo
 *   firma (aprueba o contraoferta) lo que cae dentro. Rechazar se permite siempre:
 *   negar no es firmar.
 */

/** `>= 100` es centinela de "sin limite" en ese extremo: un descuento real no llega a 100. */
const SENTINEL = 100;

/** Numero finito o `null`. Un `''` o un `NaN` no se propagan como 0. */
function num(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Banda bloqueada con su motivo. */
function blocked(reason: BlockedReason): EffectiveBand {
  return { min: null, max: null, blocked: true, reason };
}

/**
 * Banda efectiva a partir de los porcentajes crudos de SAP.
 *
 * @param limits Fila de la matriz, o `null` si el autorizador no tiene ninguna.
 */
export function effectiveBand(
  limits: { minimumPercentage: number | null; maximumPercentage: number | null } | null,
): EffectiveBand {
  if (!limits) return blocked('sin_fila');

  const rawMin = num(limits.minimumPercentage);
  const rawMax = num(limits.maximumPercentage);

  if (rawMin == null || rawMax == null) return blocked('sin_datos');
  if (rawMin === 0 && rawMax === 0) return blocked('sin_configurar');

  // Los centinelas se resuelven ANTES de juzgar inversion: un 200/50 no es un rango
  // invertido, es "sin piso" con techo 50.
  const min = rawMin >= SENTINEL ? null : rawMin;
  const max = rawMax >= SENTINEL ? null : rawMax;

  if (min != null && max != null && min > max) return blocked('rango_invertido');
  if (min == null && max == null) {
    return { min: null, max: null, blocked: false, reason: 'sin_limite' };
  }
  return { min, max, blocked: false, reason: null };
}

/** Texto que explica la banda en la UI. Una sola redaccion para toda la app. */
export function describeBand(band: EffectiveBand): string {
  switch (band.reason) {
    case 'sin_fila':
      return 'Sin fila en la matriz: no puede firmar';
    case 'sin_datos':
      return 'Límites incompletos: no puede firmar';
    case 'sin_configurar':
      return 'Sin configurar (0/0): no puede firmar';
    case 'rango_invertido':
      return 'Rango inválido (mínimo mayor que máximo): no puede firmar';
    case 'sin_limite':
      return 'Sin límite: firma cualquier descuento';
    default:
      break;
  }
  if (band.min == null && band.max != null) return `Hasta ${band.max}%`;
  if (band.min != null && band.max == null) return `Desde ${band.min}%`;
  return `${band.min}% a ${band.max}%`;
}

/** ¿La vigencia de un CEBE cubre hoy? Fechas nulas = sin restriccion en ese extremo. */
export function isAssignmentActive(
  validFrom: string | null,
  validUntil: string | null,
  today: Date = new Date(),
): boolean {
  const day = today.toISOString().slice(0, 10);
  if (validFrom && validFrom.slice(0, 10) > day) return false;
  if (validUntil && validUntil.slice(0, 10) < day) return false;
  return true;
}
