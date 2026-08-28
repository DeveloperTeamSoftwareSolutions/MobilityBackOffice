import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import type { RequestHandler, Request, Response, NextFunction } from 'express';
import {
  rewriteSetCookiePath,
  transformWabaResponse,
  WABA_PREFIX,
} from './waba-rewrite';
import { BackOfficeRole } from '../auth/backoffice-role.enum';
import type { BackOfficeJwtPayload } from '../auth/token.service';

export { WABA_PREFIX };

/** Cookie httpOnly con el JWT propio de BackOffice, scopeada a /waba. */
export const WABA_COOKIE = 'bo_waba_token';

/** Roles de BackOffice que pueden abrir el panel. SuperAdmin pasa siempre. */
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
 * Saca del header Cookie la del token de BackOffice y deja pasar el resto.
 *
 * ES LA DIFERENCIA CENTRAL CON EL PROXY DEL RAG, que borra el header entero. WABA tiene
 * **sesión propia** (`express-session` sobre SQL Server): si le quitáramos las cookies,
 * nunca podría mantener a nadie logueado. Pero su token de sesión de BackOffice tampoco
 * tiene por qué salir hacia otro proceso, así que se filtra solo ese.
 */
export function stripBackOfficeCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  const kept = cookieHeader
    .split(';')
    .map((p) => p.trim())
    .filter((p) => {
      const eq = p.indexOf('=');
      const key = eq < 0 ? p : p.slice(0, eq).trim();
      return key !== name;
    });
  return kept.length ? kept.join('; ') : undefined;
}

/**
 * Mantiene los redirects bajo el prefijo, para que uno del panel no escape del proxy y
 * cargue BackOffice dentro del iframe. WABA redirige bastante: login, selector de
 * cuenta, `/no-account`.
 */
export function rewriteRedirectLocation(location: string, prefix: string): string {
  if (!location.startsWith('/') || location.startsWith('//')) return location;
  if (location === prefix || location.startsWith(`${prefix}/`)) return location;
  return `${prefix}${location}`;
}

type VerifyFn = (token: string) => Promise<BackOfficeJwtPayload>;

/**
 * Protege el proxy `/waba`: exige sesión válida de BackOffice y un rol habilitado.
 *
 * WABA tiene su propio login, así que esto **no** reemplaza su autenticación: la suma.
 * Sin este guard, BackOffice quedaría como proxy abierto hacia el panel, y cualquiera
 * podría llegar a su pantalla de login desde afuera. Quien pasa este guard todavía tiene
 * que loguearse en WABA — son dos sesiones distintas y así se decidió por ahora.
 */
export function createWabaAuthGuard(verify: VerifyFn): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = bearerFromCookie(req.headers?.cookie, WABA_COOKIE);
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
      res.status(403).send('Rol sin acceso al panel de WhatsApp');
      return;
    }
    next();
  };
}

/**
 * Reverse-proxy hacia el panel WABA. Se monta con `app.use(WABA_PREFIX, ...)`, así que
 * Express ya quitó el prefijo del path.
 *
 * Hace falta porque WABA manda `X-Frame-Options: SAMEORIGIN` y CSP `frame-ancestors
 * 'self'` (helmet): un iframe directo desde el origen de BackOffice lo bloquea el
 * navegador. Servido bajo el mismo origen, las dos reglas se cumplen.
 */
export function createWabaProxy(target: string): RequestHandler {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    selfHandleResponse: true,
    // WABA hace POST de formularios (login, envío de mensajes) y sube archivos.
    on: {
      proxyReq: (proxyReq, req) => {
        // Se conservan las cookies de WABA (su sesión) y se saca solo la de BackOffice.
        const cookie = stripBackOfficeCookie(
          (req as Request).headers?.cookie,
          WABA_COOKIE,
        );
        if (cookie) proxyReq.setHeader('cookie', cookie);
        else proxyReq.removeHeader('cookie');
      },
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, _req, res) => {
        const status = proxyRes.statusCode ?? 200;

        const location = proxyRes.headers['location'];
        if (status >= 300 && status < 400 && typeof location === 'string') {
          res.setHeader('location', rewriteRedirectLocation(location, WABA_PREFIX));
        }

        // La cookie de sesión de WABA se acota al prefijo: si no, viaja también en las
        // requests a la API de BackOffice.
        const setCookie = proxyRes.headers['set-cookie'];
        if (Array.isArray(setCookie) && setCookie.length) {
          res.setHeader(
            'set-cookie',
            setCookie.map((c) => rewriteSetCookiePath(c, WABA_PREFIX)),
          );
        }

        const contentType = proxyRes.headers['content-type'];
        if (typeof contentType === 'string' && contentType.includes('text/html')) {
          res.setHeader('cache-control', 'no-store');
          res.removeHeader('etag');
          res.removeHeader('last-modified');
        }

        return transformWabaResponse(responseBuffer, contentType, WABA_PREFIX);
      }),
    },
  });
}
