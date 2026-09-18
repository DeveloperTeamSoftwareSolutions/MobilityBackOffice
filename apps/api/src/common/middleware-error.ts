/**
 * Lectura de los errores que devuelve MobilityMiddleWare.
 *
 * Vive acá y no dentro de un módulo porque el `code` del cuerpo es **el contrato estable**
 * del middleware: el `error` viaja en inglés y cambia con cualquier reescritura, mientras
 * que el `code` es lo que se promete en `docs/EXTERNAL_APIS.md`. Traducir mirando el texto
 * funciona hasta que alguien corrige una palabra del otro lado.
 *
 * `RegionsClient` tiene todavía su propia copia local de `httpStatus`, anterior a este
 * archivo; no se toca acá para no mezclar el traspaso de Almacenes con un refactor de
 * Regiones.
 */

/** Status HTTP de un error de axios, sin depender de su tipo. */
export function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

/** `code` del cuerpo (`{ success:false, error, code }`), si el middleware lo mandó. */
export function middlewareErrorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
}
