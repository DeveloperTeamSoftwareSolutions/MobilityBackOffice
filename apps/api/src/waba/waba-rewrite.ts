/**
 * Reescritura de rutas absolutas del panel WABA para el reverse-proxy same-origin.
 *
 * DIFERENCIA CLAVE CON EL RAG. El RAG es una SPA: alcanzaba con reescribir sus assets
 * (`/css/`, `/js/`) y su API. WABA es **server-side rendered**, así que sus enlaces de
 * navegación también son rutas absolutas (`<a href="/messages">`, `<form action="/login">`).
 *
 * Sin reescribirlos, un clic dentro del iframe navega a `https://backoffice/messages`,
 * que no es una ruta de BackOffice: el fallback SPA devuelve `index.html` y **BackOffice
 * se carga dentro de su propio iframe**. Por eso acá se reescribe la navegación entera,
 * no solo los assets.
 */

export const WABA_PREFIX = '/waba';

/**
 * Segmentos raíz que sirve el panel WABA, tomados de `routes/index.js` y de las vistas.
 *
 * Los más largos van primero: `api-logs` tiene que ganarle a `api`, si no
 * `/api-logs` se parte como `/api` + `-logs` y el lookahead lo descarta.
 */
const WABA_ROOTS = [
  'internal-logs',
  'api-logs',
  'no-account',
  'conversations',
  'accounts',
  'contacts',
  'templates',
  'messages',
  'settings',
  'webhook',
  'logout',
  'login',
  'audit',
  'users',
  'api',
  'css',
  'js',
];

/**
 * Ruta absoluta de WABA anclada a comilla.
 *
 * El lookahead exige que el segmento **termine** ahí (comilla, `/`, `?` o `#`), para no
 * tocar una ruta de otro origen que empiece igual ni partir un segmento por la mitad.
 * Anclar a la comilla evita reescribir substrings dentro de URLs de CDN
 * (`https://cdn.jsdelivr.net/npm/.../js/bootstrap.js`).
 */
const WABA_ABSOLUTE = new RegExp(
  `(["'\`])(/(?:${WABA_ROOTS.join('|')}))(?=["'\`/?#])`,
  'g',
);

/** `href="/"` — la raíz del panel. Se trata aparte: no tiene segmento que anclar. */
const WABA_ROOT_LINK = /(["'`])\/(["'`])/g;

/**
 * Antepone `prefix` a las rutas absolutas de WABA en un body (HTML o JS).
 *
 * Deja intactas las URLs de CDN y cualquier ruta que no empiece con un segmento
 * conocido del panel.
 */
export function rewriteWabaPaths(body: string, prefix: string): string {
  return body
    .replace(WABA_ABSOLUTE, (_m, quote: string, path: string) => `${quote}${prefix}${path}`)
    .replace(WABA_ROOT_LINK, (_m, open: string, close: string) => `${open}${prefix}/${close}`);
}

/**
 * Solo HTML y JS traen rutas. El JSON de la API y las imágenes no se tocan: reescribir
 * dentro de un payload de datos corrompería el contenido.
 */
export function shouldRewrite(contentType?: string): boolean {
  return !!contentType && /text\/html|javascript/i.test(contentType);
}

/** Transforma el body de la respuesta, o lo devuelve intacto si no corresponde. */
export function transformWabaResponse(
  buffer: Buffer,
  contentType: string | undefined,
  prefix: string,
): Buffer | string {
  if (!shouldRewrite(contentType)) return buffer;
  return rewriteWabaPaths(buffer.toString('utf8'), prefix);
}

/**
 * Reescribe el `Path` de las cookies que setea WABA para acotarlas al prefijo.
 *
 * WABA setea su cookie de sesión con `Path=/`. Servida bajo `/waba`, esa cookie viajaría
 * en TODAS las requests a BackOffice — incluidas las de su API. Acotarla mantiene las dos
 * sesiones separadas y evita que el navegador mande la de WABA donde no corresponde.
 */
export function rewriteSetCookiePath(setCookie: string, prefix: string): string {
  if (/;\s*path=/i.test(setCookie)) {
    return setCookie.replace(/;\s*path=[^;]*/i, `; Path=${prefix}`);
  }
  return `${setCookie}; Path=${prefix}`;
}
