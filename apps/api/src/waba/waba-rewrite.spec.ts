import {
  rewriteSetCookiePath,
  rewriteWabaPaths,
  shouldRewrite,
  transformWabaResponse,
  WABA_PREFIX,
} from './waba-rewrite';

const P = WABA_PREFIX;

describe('rewriteWabaPaths — navegacion', () => {
  /**
   * El caso que justifica todo el modulo: WABA es server-side rendered y sus enlaces
   * son absolutos. Sin reescribirlos, un clic en el iframe navega a la raiz de
   * BackOffice, el fallback SPA devuelve index.html y BackOffice se carga dentro de su
   * propio iframe.
   */
  it('reescribe los enlaces del panel', () => {
    expect(rewriteWabaPaths('<a href="/messages">Mensajes</a>', P)).toBe(
      '<a href="/waba/messages">Mensajes</a>',
    );
  });

  it('reescribe el action de los formularios', () => {
    expect(rewriteWabaPaths('<form action="/login" method="post">', P)).toBe(
      '<form action="/waba/login" method="post">',
    );
  });

  it('reescribe la raiz del panel', () => {
    expect(rewriteWabaPaths('<a href="/">Inicio</a>', P)).toBe('<a href="/waba/">Inicio</a>');
  });

  it('reescribe rutas con segmentos adicionales', () => {
    expect(rewriteWabaPaths('href="/contacts/42/edit"', P)).toBe('href="/waba/contacts/42/edit"');
  });

  it('reescribe rutas con query string', () => {
    expect(rewriteWabaPaths('href="/messages?page=2"', P)).toBe('href="/waba/messages?page=2"');
  });

  it('reescribe todos los segmentos raiz del panel', () => {
    for (const seg of [
      'accounts',
      'contacts',
      'templates',
      'messages',
      'conversations',
      'users',
      'settings',
      'audit',
      'logout',
      'login',
      'webhook',
      'no-account',
    ]) {
      expect(rewriteWabaPaths(`href="/${seg}/"`, P)).toBe(`href="/waba/${seg}/"`);
    }
  });

  it('api-logs e internal-logs no se parten como /api', () => {
    // Sin ordenar los segmentos de mayor a menor, `/api-logs` matchea `/api` y el
    // lookahead lo descarta: el enlace quedaria sin reescribir.
    expect(rewriteWabaPaths('href="/api-logs/"', P)).toBe('href="/waba/api-logs/"');
    expect(rewriteWabaPaths('href="/internal-logs/"', P)).toBe('href="/waba/internal-logs/"');
  });
});

describe('rewriteWabaPaths — assets y llamadas del cliente', () => {
  it('reescribe css y js propios', () => {
    expect(rewriteWabaPaths('<link href="/css/style.css">', P)).toBe(
      '<link href="/waba/css/style.css">',
    );
    expect(rewriteWabaPaths('<script src="/js/app.js">', P)).toBe(
      '<script src="/waba/js/app.js">',
    );
  });

  it('reescribe los fetch del cliente a su API', () => {
    expect(rewriteWabaPaths("fetch('/api/messages/send')", P)).toBe(
      "fetch('/waba/api/messages/send')",
    );
  });
});

describe('rewriteWabaPaths — lo que NO debe tocar', () => {
  it('deja intactas las URLs de CDN', () => {
    // Es el motivo de anclar a la comilla: sin eso, el `/js/` de jsdelivr se rompe.
    const cdn = '<script src="https://cdn.jsdelivr.net/npm/bootstrap/dist/js/bootstrap.js">';
    expect(rewriteWabaPaths(cdn, P)).toBe(cdn);
  });

  it('deja intactas las URLs protocol-relative', () => {
    const url = '<script src="//cdn.jsdelivr.net/js/x.js">';
    expect(rewriteWabaPaths(url, P)).toBe(url);
  });

  it('no toca rutas que no son del panel', () => {
    expect(rewriteWabaPaths('href="/otra-cosa"', P)).toBe('href="/otra-cosa"');
  });

  it('no toca un segmento que solo empieza igual', () => {
    // `/messagesX` no es `/messages`: el lookahead exige que el segmento termine.
    expect(rewriteWabaPaths('href="/messagesX"', P)).toBe('href="/messagesX"');
  });

  it('no reescribe dos veces una ruta ya prefijada', () => {
    // `/waba` no esta en la lista de segmentos, asi que no vuelve a matchear.
    const ya = 'href="/waba/messages"';
    expect(rewriteWabaPaths(ya, P)).toBe(ya);
  });
});

describe('shouldRewrite', () => {
  it('reescribe HTML y JS', () => {
    expect(shouldRewrite('text/html; charset=utf-8')).toBe(true);
    expect(shouldRewrite('application/javascript')).toBe(true);
  });

  it('NO reescribe JSON: corromperia los datos', () => {
    expect(shouldRewrite('application/json')).toBe(false);
  });

  it('NO reescribe imagenes ni tipos desconocidos', () => {
    expect(shouldRewrite('image/png')).toBe(false);
    expect(shouldRewrite(undefined)).toBe(false);
  });
});

describe('transformWabaResponse', () => {
  it('devuelve el buffer intacto cuando no corresponde reescribir', () => {
    const buf = Buffer.from('{"path":"/messages"}');
    expect(transformWabaResponse(buf, 'application/json', P)).toBe(buf);
  });

  it('reescribe cuando el content-type lo amerita', () => {
    const buf = Buffer.from('<a href="/messages">');
    expect(transformWabaResponse(buf, 'text/html', P)).toBe('<a href="/waba/messages">');
  });
});

describe('rewriteSetCookiePath', () => {
  /**
   * WABA setea su cookie de sesion con Path=/. Servida bajo /waba, esa cookie viajaria
   * en todas las requests a BackOffice, incluidas las de su propia API.
   */
  it('acota al prefijo una cookie con Path=/', () => {
    expect(rewriteSetCookiePath('connect.sid=abc; Path=/; HttpOnly', P)).toBe(
      'connect.sid=abc; Path=/waba; HttpOnly',
    );
  });

  it('agrega el Path si la cookie no lo declara', () => {
    expect(rewriteSetCookiePath('connect.sid=abc; HttpOnly', P)).toBe(
      'connect.sid=abc; HttpOnly; Path=/waba',
    );
  });

  it('reemplaza un Path que ya apuntaba a otro lado', () => {
    expect(rewriteSetCookiePath('a=1; path=/otro; Secure', P)).toBe('a=1; Path=/waba; Secure');
  });

  it('conserva el resto de los atributos', () => {
    const out = rewriteSetCookiePath('s=1; Path=/; HttpOnly; SameSite=Lax; Secure', P);
    expect(out).toContain('HttpOnly');
    expect(out).toContain('SameSite=Lax');
    expect(out).toContain('Secure');
    expect(out).toContain('Path=/waba');
  });
});
