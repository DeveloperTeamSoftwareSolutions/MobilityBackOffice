import type { ConfigService } from '@nestjs/config';

/**
 * Base URL y headers comunes para hablar con MobilityMiddleWare.
 *
 * Existe para que los clientes del middleware (`regions`, `audit`) no dupliquen la misma
 * lógica — y, sobre todo, para que el header de identificación se agregue en UN solo lugar.
 */

/**
 * Identifica a esta app en los `ApiLogs` del middleware.
 *
 * El middleware audita AUTOMÁTICAMENTE cada request entrante (una fila por request:
 * método, endpoint, status, tiempo, éxito), y el campo `SourceApp` lo toma del header
 * `x-source-app`, con fallback `'mobility-middleware'`. Si el consumidor no lo manda,
 * su tráfico queda indistinguible del propio middleware y la auditoría pierde el dato
 * más importante: QUIÉN llamó.
 *
 * Ver docs/EXTERNAL_APIS.md.
 */
export const SOURCE_APP = 'MobilityBackOffice';

/** Base del middleware, sin barras finales. '' si no está configurado. */
export function middlewareBase(config: ConfigService): string {
  return (config.get<string>('middleware.url') ?? '').replace(/\/+$/, '');
}

/**
 * Headers para toda request al middleware.
 *
 * - `x-source-app`: SIEMPRE. Es lo que hace atribuible la auditoría del middleware.
 * - `x-api-key`: solo si `MIDDLEWARE_API_KEY` está configurada. El middleware valida
 *   con `requireApiKey`, que es no-op cuando su propia env no está seteada.
 */
export function middlewareHeaders(config: ConfigService): Record<string, string> {
  const headers: Record<string, string> = { 'x-source-app': SOURCE_APP };
  const key = config.get<string>('middleware.apiKey');
  if (key) headers['x-api-key'] = key;
  return headers;
}
