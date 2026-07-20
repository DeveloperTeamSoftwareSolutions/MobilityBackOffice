/**
 * Helpers de lectura del JWT en el cliente.
 *
 * OJO: esto NO verifica la firma — no puede, el secret vive en el servidor. Sirve
 * solo para saber cuándo vence la sesión y desloguear a tiempo. Toda decisión de
 * seguridad la toma el backend.
 */

interface JwtClaims {
  exp?: number;
}

/** Decodifica el payload sin verificar. Devuelve null si el token es ilegible. */
function decodeClaims(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    // base64url -> base64
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)) as JwtClaims;
  } catch {
    return null;
  }
}

/** Instante de expiración en milisegundos, o null si el token no declara `exp`. */
export function jwtExpiryMs(token: string): number | null {
  const claims = decodeClaims(token);
  if (!claims || typeof claims.exp !== 'number') return null;
  return claims.exp * 1000;
}

/**
 * ¿El token está vencido? Un token ilegible o sin `exp` se considera vencido:
 * ante la duda, se cierra la sesión.
 */
export function isJwtExpired(token: string): boolean {
  const expMs = jwtExpiryMs(token);
  if (expMs === null) return true;
  return Date.now() >= expMs;
}
