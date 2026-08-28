import { AuthorizerProfitCenter, EffectiveBand } from './autorizadores.types';

/**
 * Cómo se lee la matriz en pantalla. Una sola redacción para toda la sección.
 *
 * La interpretación de la banda la hace el backend (`authorizers.band.ts`); acá solo se
 * la pone en palabras. Los porcentajes crudos NO se muestran fuera del detalle.
 */

/** Texto principal de la banda: es lo que va en la columna. */
export function bandLabel(band: EffectiveBand): string {
  switch (band.reason) {
    case 'sin_fila':
      return 'Sin fila en la matriz';
    case 'sin_datos':
      return 'Límites incompletos';
    case 'sin_configurar':
      return 'Sin configurar';
    case 'rango_invertido':
      return 'Rango inválido';
    case 'sin_limite':
      return 'Sin límite';
    default:
      break;
  }
  if (band.min == null && band.max != null) return `Hasta ${band.max}%`;
  if (band.min != null && band.max == null) return `Desde ${band.min}%`;
  return `${band.min}% a ${band.max}%`;
}

/** Aclaración de una línea bajo la banda. `null` cuando no hace falta explicar nada. */
export function bandHint(band: EffectiveBand): string | null {
  if (band.blocked) return 'No puede aprobar ni contraofertar; solo rechazar';
  if (band.reason === 'sin_limite') return 'Firma cualquier descuento';
  return null;
}

/**
 * Vencimiento de una asignación de CEBE.
 *
 * SAP usa `9999-12-31` como "sin vencimiento" en vez de NULL. Mostrar esa fecha literal
 * confunde a quien la lee.
 */
const SIN_VENCIMIENTO = '9999-12-31';

export function formatValidUntil(validUntil: string | null): string {
  if (!validUntil) return 'Sin vencimiento';
  const day = validUntil.slice(0, 10);
  if (day >= SIN_VENCIMIENTO) return 'Sin vencimiento';
  return formatDate(day);
}

export function formatValidFrom(validFrom: string | null): string {
  if (!validFrom) return 'Sin fecha de inicio';
  return formatDate(validFrom.slice(0, 10));
}

/** `2026-08-27` → `27/08/2026`. Sin `Date`: la fecha viene sin hora y no se le agrega. */
function formatDate(day: string): string {
  const [y, m, d] = day.split('-');
  return y && m && d ? `${d}/${m}/${y}` : day;
}

/** Cómo se rotula el alcance de un autorizador. */
export function scopeLabel(
  coversWholeCompany: boolean,
  profitCenters: AuthorizerProfitCenter[],
  activeCount: number,
): string {
  if (coversWholeCompany) return 'Toda la sociedad';
  if (profitCenters.length === 0) return 'Sin CEBEs asignados';
  if (activeCount === 0) return `${profitCenters.length} CEBE(s), ninguno vigente`;
  if (activeCount === profitCenters.length) return `${activeCount} CEBE(s)`;
  return `${activeCount} de ${profitCenters.length} CEBE(s) vigentes`;
}

/** Nombre del CEBE si el maestro lo tiene; si no, el código solo. */
export function profitCenterLabel(pc: AuthorizerProfitCenter): string {
  return pc.name ? `${pc.code} · ${pc.name}` : pc.code;
}
