import { AsyncLocalStorage } from 'async_hooks';

/**
 * Quién hizo esta llamada, disponible en cualquier punto sin enhebrarlo por cada
 * firma.
 *
 * El middleware audita cada movimiento de una orden o cotización en
 * `DocumentAuditLog` y guarda CON QUÉ ROL se disparó (header `x-actor-role`).
 * Quien arma los headers es `middlewareHeaders(config)`, que recibe la config y
 * no el request: pasarle el usuario significaría tocar la firma de todos los
 * clientes, y cada cliente nuevo que se olvidara dejaría un hueco silencioso en
 * la auditoría.
 *
 * Fuera de una request (jobs, tests) `actorRole()` devuelve null y los headers
 * salen como antes. Nunca rompe.
 */
interface Contexto {
  actorRole?: string | null;
  actorEmail?: string | null;
}

const storage = new AsyncLocalStorage<Contexto>();

/** Abre el contexto de una request. */
export function run<T>(fn: () => T): T {
  return storage.run({}, fn);
}

/** Forma mínima del payload del JWT que emite ITManager. */
interface UsuarioDelToken {
  email?: string;
  roles?: unknown;
  isAdmin?: boolean;
}

/**
 * Guarda quién es el usuario ya autenticado. Lo llama el guard apenas valida el
 * token: el contexto ya está abierto, así que se completa el MISMO objeto.
 *
 * ROL: se manda uno solo, el que explica la acción. Admin gana porque es el que
 * habilita lo que los demás no pueden.
 */
export function setActor(user: unknown): void {
  const ctx = storage.getStore();
  if (!ctx || !user || typeof user !== 'object') return;
  const u = user as UsuarioDelToken;
  ctx.actorEmail = typeof u.email === 'string' ? u.email : null;
  const roles = Array.isArray(u.roles) ? u.roles.filter(Boolean) : [];
  ctx.actorRole = u.isAdmin === true ? 'admin' : (roles.length ? String(roles[0]) : null);
}

/** El rol con el que actúa quien hizo la llamada, o null. */
export function actorRole(): string | null {
  const ctx = storage.getStore();
  const r = ctx?.actorRole;
  return r ? String(r).slice(0, 32) : null;
}

/** El email de quien hizo la llamada, o null. */
export function actorEmail(): string | null {
  return storage.getStore()?.actorEmail ?? null;
}
