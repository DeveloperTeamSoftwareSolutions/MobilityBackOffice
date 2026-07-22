import {
  rewriteRagAssets,
  shouldRewrite,
  transformRagResponse,
  RAG_PREFIX,
} from './rag-rewrite';

describe('rewriteRagAssets', () => {
  it('antepone el prefijo a las rutas de css absolutas', () => {
    expect(rewriteRagAssets('<link href="/css/app.css?v=0.3.0">', RAG_PREFIX)).toBe(
      '<link href="/rag/css/app.css?v=0.3.0">',
    );
  });

  it('reescribe rutas de js', () => {
    expect(rewriteRagAssets('<script src="/js/api.js"></script>', RAG_PREFIX)).toBe(
      '<script src="/rag/js/api.js"></script>',
    );
  });

  it('reescribe llamadas a la API (comilla simple)', () => {
    expect(rewriteRagAssets("fetch('/api/documents?limit=10')", RAG_PREFIX)).toBe(
      "fetch('/rag/api/documents?limit=10')",
    );
  });

  it('reescribe con backtick', () => {
    expect(rewriteRagAssets('url(`/api/search`)', RAG_PREFIX)).toBe(
      'url(`/rag/api/search`)',
    );
  });

  it('NO toca URLs de CDN (https absolutas)', () => {
    const cdn = '<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">';
    expect(rewriteRagAssets(cdn, RAG_PREFIX)).toBe(cdn);
  });

  it('NO toca una ruta que solo contiene /api/ como substring sin comilla', () => {
    // p. ej. dentro de una URL de CDN: .../dist/api/... no debe reescribirse
    const s = 'https://x.com/dist/api/thing.js';
    expect(rewriteRagAssets(s, RAG_PREFIX)).toBe(s);
  });

  it('no duplica el prefijo si ya esta puesto', () => {
    // idempotencia razonable: /rag/api ya no empieza con comilla+/api directo
    const ya = '"/rag/api/documents"';
    expect(rewriteRagAssets(ya, RAG_PREFIX)).toBe(ya);
  });

  it('reescribe varias ocurrencias en el mismo body', () => {
    const html = '<link href="/css/app.css"><script src="/js/app.js"></script>';
    expect(rewriteRagAssets(html, RAG_PREFIX)).toBe(
      '<link href="/rag/css/app.css"><script src="/rag/js/app.js"></script>',
    );
  });
});

describe('shouldRewrite', () => {
  it('reescribe HTML', () => {
    expect(shouldRewrite('text/html; charset=UTF-8')).toBe(true);
  });

  it('reescribe JavaScript', () => {
    expect(shouldRewrite('application/javascript')).toBe(true);
    expect(shouldRewrite('text/javascript')).toBe(true);
  });

  it('NO reescribe JSON (datos de la API)', () => {
    expect(shouldRewrite('application/json')).toBe(false);
  });

  it('NO reescribe imagenes', () => {
    expect(shouldRewrite('image/png')).toBe(false);
  });

  it('sin content-type no reescribe', () => {
    expect(shouldRewrite(undefined)).toBe(false);
  });
});

describe('transformRagResponse', () => {
  it('reescribe cuando el content-type es HTML', () => {
    const out = transformRagResponse(
      Buffer.from('<link href="/css/app.css">'),
      'text/html',
      RAG_PREFIX,
    );
    expect(out).toBe('<link href="/rag/css/app.css">');
  });

  it('devuelve el buffer intacto para JSON', () => {
    const buf = Buffer.from('{"success":true}');
    expect(transformRagResponse(buf, 'application/json', RAG_PREFIX)).toBe(buf);
  });
});
