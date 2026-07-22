/**
 * Reescritura de rutas absolutas de DuwyEngineRAG para el reverse-proxy same-origin.
 *
 * El RAG sirve sus assets y su API con rutas absolutas (`/css/`, `/js/`, `/api/`).
 * Al embeberlo bajo `/rag`, esas rutas apuntarian a la raiz del origen de BackOffice
 * (donde /api es la API de BackOffice, no la del RAG). Se reescriben anteponiendo el
 * prefijo, para que todo el trafico del iframe quede bajo `/rag`.
 */

export const RAG_PREFIX = '/rag';

/**
 * Rutas raiz absolutas del RAG a reescribir. Se anclan a una comilla (inicio de URL)
 * para no tocar substrings dentro de URLs de CDN (`https://.../dist/api/...`).
 */
const RAG_ROOTS = /(["'`])(\/(?:css\/|js\/|api\/))/g;

/**
 * Antepone `prefix` a las rutas absolutas conocidas del RAG en un body (HTML o JS).
 * Solo toca rutas ancladas a comilla; deja intactas las URLs de CDN.
 */
export function rewriteRagAssets(body: string, prefix: string): string {
  return body.replace(
    RAG_ROOTS,
    (_match, quote: string, path: string) => `${quote}${prefix}${path}`,
  );
}

/**
 * Solo HTML y JS contienen rutas de assets. JSON (datos de la API) e imagenes no se
 * tocan.
 */
export function shouldRewrite(contentType?: string): boolean {
  return !!contentType && /text\/html|javascript/i.test(contentType);
}

/**
 * Transforma el body de una respuesta del proxy: reescribe si el Content-Type lo
 * amerita, o devuelve el buffer original.
 */
export function transformRagResponse(
  buffer: Buffer,
  contentType: string | undefined,
  prefix: string,
): Buffer | string {
  if (!shouldRewrite(contentType)) return buffer;
  return rewriteRagAssets(buffer.toString('utf8'), prefix);
}
