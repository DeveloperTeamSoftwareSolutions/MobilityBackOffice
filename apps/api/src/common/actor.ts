/**
 * Quien esta haciendo la accion, sacado del token.
 *
 * Vive aca y no en cada controlador porque los tres campos van juntos a la auditoria y
 * olvidarse de uno no rompe nada visible: la fila se guarda igual, solo que incompleta.
 * Eso ya paso — `guidApiLoginClients` faltaba en todas, y las filas quedaron invisibles
 * desde ITManager durante meses sin que nadie lo notara.
 */
export interface Actor {
  email?: string;
  guid?: string;
  /**
   * Cliente al que pertenece (`ApiLoginClients.Guid`), tal como lo devolvio ITManager.
   *
   * **La auditoria de ITManager filtra por este campo.** Una fila sin el se guarda pero
   * no se ve del otro lado.
   */
  guidApiLoginClients?: string | null;
}

/** El request ya autenticado: lo que `JwtGuard` deja en `req.user`. */
export interface AuthedRequest {
  user?: {
    email?: string;
    guid?: string;
    sub?: string;
    guidApiLoginClients?: string | null;
  };
}

/**
 * El actor del request.
 *
 * `guid` cae a `sub` porque los dos claims llevan el mismo `Users.Guid`: `sub` es el
 * estandar de JWT y `guid` el nombre del ecosistema.
 */
export function actorFrom(req: AuthedRequest): Actor {
  return {
    email: req.user?.email,
    guid: req.user?.guid ?? req.user?.sub,
    guidApiLoginClients: req.user?.guidApiLoginClients ?? null,
  };
}
