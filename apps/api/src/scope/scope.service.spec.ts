import { ScopeService } from './scope.service';
import { ScopeClient, UserScope } from './scope.client';

/**
 * El alcance NO se calcula acá: lo resuelve el middleware y este servicio lo consume. Lo que
 * queda por probar es cómo INTERPRETA lo que recibe, y el caché — que no es una optimización
 * de prolijidad sino la corrección de un incidente de producción.
 */
describe('ScopeService', () => {
  const USUARIO = 'U-1';

  function make(scope: Partial<UserScope> = {}) {
    const getUserScope = jest.fn().mockResolvedValue({
      isAdmin: false,
      userGuids: [],
      companyCodes: [],
      ...scope,
    } as UserScope);
    return {
      service: new ScopeService({ getUserScope } as unknown as ScopeClient),
      getUserScope,
    };
  }

  describe('getScopeCompanyCodes', () => {
    it('admin → isAdmin true y lista VACÍA (el consumidor no filtra)', async () => {
      // Vacía significa "ve todas", no "no ve ninguna". Si algún día se llenara con las
      // sociedades de su subárbol, un admin pasaría a ver MENOS.
      const { service } = make({ isAdmin: true, companyCodes: [] });
      expect(await service.getScopeCompanyCodes(USUARIO)).toEqual({
        isAdmin: true,
        companyCodes: [],
      });
    });

    it('no-admin → sus sociedades', async () => {
      const { service } = make({ isAdmin: false, companyCodes: ['2100', '2000'] });
      expect(await service.getScopeCompanyCodes(USUARIO)).toEqual({
        isAdmin: false,
        companyCodes: ['2100', '2000'],
      });
    });

    it('no-admin sin sociedades → lista vacía, que acá SÍ significa "no ve nada"', async () => {
      // Mismo valor, sentido opuesto según isAdmin. Por eso los dos campos viajan juntos y el
      // consumidor tiene que mirar los dos.
      const { service } = make({ isAdmin: false, companyCodes: [] });
      expect(await service.getScopeCompanyCodes(USUARIO)).toEqual({
        isAdmin: false,
        companyCodes: [],
      });
    });

    it('pide el alcance SIN auto-inclusión', async () => {
      // BackOffice sólo necesita las sociedades del subárbol; el usuario propio no cambia ese
      // conjunto. Si el default cambiara, el caché guardaría otra entrada sin que nada falle.
      const { service, getUserScope } = make();
      await service.getScopeCompanyCodes(USUARIO);
      expect(getUserScope).toHaveBeenCalledWith(USUARIO, false);
    });
  });

  /**
   * El caché existe por un incidente concreto, no por prolijidad: el **2026-08-12** se vieron
   * en producción SIETE `user-scope` idénticos muriendo por timeout en el mismo segundo,
   * porque cada endpoint de la pantalla resolvía el alcance por su cuenta.
   */
  describe('caché', () => {
    it('una ráfaga concurrente dispara UNA sola llamada al middleware', async () => {
      // ESTE es el test del bug. Con un caché de RESULTADOS todas fallarían el lookup a la
      // vez —ninguna terminó todavía— y saldrían las 8 igual. Sólo pasa si lo que se guarda
      // es la promesa.
      let resolver: (v: UserScope) => void = () => {};
      const getUserScope = jest.fn().mockReturnValue(
        new Promise<UserScope>((res) => {
          resolver = res;
        }),
      );
      const service = new ScopeService({ getUserScope } as unknown as ScopeClient);

      const enVuelo = Array.from({ length: 8 }, () => service.getScopeCompanyCodes(USUARIO));
      resolver({ isAdmin: false, userGuids: [], companyCodes: ['2100'] });

      expect(await Promise.all(enVuelo)).toEqual(
        Array(8).fill({ isAdmin: false, companyCodes: ['2100'] }),
      );
      expect(getUserScope).toHaveBeenCalledTimes(1);
    });

    it('llamadas seguidas dentro del TTL no vuelven a preguntar', async () => {
      const { service, getUserScope } = make({ companyCodes: ['2100'] });
      await service.getScopeCompanyCodes(USUARIO);
      await service.getScopeCompanyCodes(USUARIO);
      await service.getScopeCompanyCodes(USUARIO);
      expect(getUserScope).toHaveBeenCalledTimes(1);
    });

    it('un fallo NO queda cacheado: la próxima request reintenta', async () => {
      // Cachear el rechazo dejaría la pantalla rota durante todo el TTL por un hipo del
      // middleware, y el usuario no tendría forma de salir de ahí más que esperando.
      const getUserScope = jest
        .fn()
        .mockRejectedValueOnce(new Error('MW caido'))
        .mockResolvedValue({ isAdmin: false, userGuids: [], companyCodes: ['2100'] });
      const service = new ScopeService({ getUserScope } as unknown as ScopeClient);

      await expect(service.getScopeCompanyCodes(USUARIO)).rejects.toThrow('MW caido');
      expect(await service.getScopeCompanyCodes(USUARIO)).toEqual({
        isAdmin: false,
        companyCodes: ['2100'],
      });
      expect(getUserScope).toHaveBeenCalledTimes(2);
    });

    it('vencido el TTL vuelve a preguntar', async () => {
      const { service, getUserScope } = make({ companyCodes: ['2100'] });
      const real = Date.now;
      try {
        await service.getScopeCompanyCodes(USUARIO);
        Date.now = () => real() + 10 * 60 * 1000; // 10 min después
        await service.getScopeCompanyCodes(USUARIO);
      } finally {
        Date.now = real;
      }
      expect(getUserScope).toHaveBeenCalledTimes(2);
    });

    it('usuarios distintos no comparten alcance', async () => {
      // Sería una fuga de datos entre usuarios, no un problema de performance.
      const { service, getUserScope } = make({ companyCodes: ['2100'] });
      await service.getScopeCompanyCodes('U-1');
      await service.getScopeCompanyCodes('U-2');
      expect(getUserScope).toHaveBeenCalledTimes(2);
    });

    it('clear() obliga a volver a preguntar', async () => {
      const { service, getUserScope } = make({ companyCodes: ['2100'] });
      await service.getScopeCompanyCodes(USUARIO);
      service.clear();
      await service.getScopeCompanyCodes(USUARIO);
      expect(getUserScope).toHaveBeenCalledTimes(2);
    });
  });
});
