import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import type { RequestHandler, Request, Response, NextFunction } from 'express';
import { transformRagResponse, RAG_PREFIX } from './rag-rewrite';
import { BackOfficeRole } from '../auth/backoffice-role.enum';
import type { BackOfficeJwtPayload } from '../auth/token.service';

export { RAG_PREFIX };

/** Cookie httpOnly con el JWT propio de BackOffice, scopeada a /rag. */
export const RAG_COOKIE = 'bo_rag_token';

/** Roles que pueden acceder al RAG. SuperAdmin pasa siempre. */
const ALLOWED_ROLES: readonly string[] = [
  BackOfficeRole.Marketing,
  BackOfficeRole.Usuario,
  BackOfficeRole.SuperAdmin,
];

/** Extrae el valor de una cookie por nombre del header Cookie. */
export function bearerFromCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim() || undefined;
    }
  }
  return undefined;
}

/**
 * Mantiene los redirects (Location) bajo el prefijo /rag, para que un redirect del
 * RAG no escape del proxy y cargue BackOffice en el iframe (recursion). No toca URLs
 * absolutas (http) ni protocol-relative (//).
 */
export function rewriteRedirectLocation(location: string, prefix: string): string {
  if (!location.startsWith('/') || location.startsWith('//')) return location;
  if (location === prefix || location.startsWith(`${prefix}/`)) return location;
  return `${prefix}${location}`;
}

type VerifyFn = (token: string) => Promise<BackOfficeJwtPayload>;

/**
 * Middleware que protege el proxy /rag: exige una cookie de sesion valida de
 * BackOffice y rol Marketing o SuperAdmin. El RAG no tiene auth propia, asi que esta
 * es la unica barrera — sin ella BackOffice seria un proxy abierto. Corre antes del
 * proxy; si no autoriza, responde y no proxya.
 */
export function createRagAuthGuard(verify: VerifyFn): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = bearerFromCookie(req.headers?.cookie, RAG_COOKIE);
    if (!token) {
      res.status(401).send('Sesion de BackOffice requerida');
      return;
    }
    let payload: BackOfficeJwtPayload;
    try {
      payload = await verify(token);
    } catch {
      res.status(401).send('Sesion invalida o expirada');
      return;
    }
    if (typeof payload?.role !== 'string' || !ALLOWED_ROLES.includes(payload.role)) {
      res.status(403).send('Rol sin acceso al RAG');
      return;
    }
    next();
  };
}

/**
 * Reverse-proxy hacia DuwyEngineRAG. Se monta con app.use(RAG_PREFIX, ...): Express
 * quita el prefijo /rag del path. Reescribe las rutas absolutas del RAG (css/js/api)
 * para que queden bajo /rag, mantiene los redirects bajo el prefijo, fuerza no-store
 * en el HTML y NO reenvia las cookies del browser al RAG (la del token de BackOffice
 * no debe salir del origen).
 */
export function createRagProxy(target: string): RequestHandler {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    selfHandleResponse: true,
    on: {
      proxyReq: (proxyReq) => {
        // El RAG no usa las cookies de BackOffice; no le mandamos ninguna (evita
        // filtrar el token propio al upstream).
        proxyReq.removeHeader('cookie');
      },
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, _req, res) => {
        const status = proxyRes.statusCode ?? 200;
        const location = proxyRes.headers['location'];
        if (status >= 300 && status < 400 && typeof location === 'string') {
          res.setHeader('location', rewriteRedirectLocation(location, RAG_PREFIX));
        }

        const contentType = proxyRes.headers['content-type'];
        if (typeof contentType === 'string' && contentType.includes('text/html')) {
          res.setHeader('cache-control', 'no-store');
          res.removeHeader('etag');
          res.removeHeader('last-modified');
        }

        return transformRagResponse(responseBuffer, contentType, RAG_PREFIX);
      }),
    },
  });
}
