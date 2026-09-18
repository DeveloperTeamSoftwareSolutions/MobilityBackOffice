import { Injectable } from '@nestjs/common';
import { ScopeClient, UserScope } from './scope.client';

/**
 * Cuánto se confía en un scope ya resuelto antes de volver a preguntarle al middleware.
 *
 * Un minuto alcanza para lo que motivó el caché —colapsar la ráfaga de una pantalla— y deja
 * el árbol razonablemente fresco: si alguien cambia de equipo en el organigrama, tarda como
 * mucho ese minuto en verse. Ajustable por entorno sin desplegar.
 */
const TTL_MS = parseInt(process.env.SCOPE_CACHE_TTL_MS || '60000', 10);

/** Techo de entradas, para que muchos usuarios concurrentes no hagan crecer la memoria. */
const MAX_ENTRADAS = 500;

interface CacheEntry {
  /**
   * La PROMESA, no el valor ya resuelto. Es la parte que arregla el problema: ver el
   * comentario de `getUserScope`.
   */
  promise: Promise<UserScope>;
  at: number;
}

/**
 * Fuente única del alcance por jerarquía en BackOffice.
 *
 * Hoy lo consume **Almacenes**, que filtra por sociedad. El resto de las secciones no lleva
 * eje jerárquico y no debe empezar a llevarlo por inercia: Regiones es dato maestro global y
 * la decisión de que NO se recorte está escrita en `docs/JERARQUIA_Y_VISIBILIDAD.md`.
 *
 * Portado de MobilityManager. De su superficie se trae **sólo lo que BackOffice usa**
 * (`getScopeCompanyCodes`): `getScopeUserGuids` e `isInScope` sirven a las vistas de equipo
 * de geo y WABA, que acá no existen, y traerlas sin consumidor sería superficie muerta que
 * el día de mañana alguien usa creyendo que está probada.
 */
@Injectable()
export class ScopeService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly client: ScopeClient) {}

  /**
   * Punto ÚNICO por donde este servicio le pregunta al middleware.
   *
   * **Se cachea la PROMESA, no el resultado.** No es un detalle de estilo: es lo que arregla
   * el problema real. Una pantalla dispara varias requests a la vez y cada una resuelve el
   * alcance por su cuenta. Con un caché de resultados, todas fallan el lookup en el mismo
   * instante —ninguna terminó todavía— y salen todas al middleware igual. Se vio en
   * producción el **2026-08-12: siete `user-scope` idénticos en el mismo segundo**, todos
   * muriendo por timeout. Guardando la promesa, la primera dispara la llamada y las demás se
   * cuelgan de esa misma.
   *
   * Un rechazo NO queda cacheado: se borra la entrada para que la próxima request reintente.
   * Cachear el error dejaría al usuario con la pantalla rota durante todo el TTL por un hipo
   * del middleware.
   */
  private getUserScope(guidUsers: string, includeSelf: boolean): Promise<UserScope> {
    // includeSelf entra en la clave: el middleware devuelve conjuntos distintos.
    const key = `${guidUsers}|${includeSelf ? 1 : 0}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at <= TTL_MS) return hit.promise;

    const promise = this.client.getUserScope(guidUsers, includeSelf).catch((err) => {
      if (this.cache.get(key)?.promise === promise) this.cache.delete(key);
      throw err;
    });

    // Map conserva el orden de inserción: la primera clave es la más vieja.
    if (this.cache.size >= MAX_ENTRADAS) {
      const masVieja = this.cache.keys().next().value;
      if (masVieja !== undefined) this.cache.delete(masVieja);
    }
    this.cache.set(key, { promise, at: Date.now() });
    return promise;
  }

  /** Olvida lo cacheado. Para los tests y para forzar una re-lectura si hiciera falta. */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Sociedades (`SapCompanyCode`) del alcance del usuario, para los consumidores que
   * scopean por sociedad (hoy, Almacenes).
   *
   * Admin (rol IT) → `isAdmin: true` y lista **vacía**: el consumidor no filtra, o sea que
   * ve todas. No-admin → las sociedades de su subárbol, que pueden ser **vacías y ahí sí
   * significa "no ve nada"**. Mismo valor, sentido opuesto según `isAdmin`: por eso los dos
   * campos viajan juntos y hay que mirar los dos.
   */
  async getScopeCompanyCodes(
    guidUsers: string,
  ): Promise<{ isAdmin: boolean; companyCodes: string[] }> {
    const scope = await this.getUserScope(guidUsers, false);
    return { isAdmin: scope.isAdmin, companyCodes: scope.companyCodes };
  }
}
