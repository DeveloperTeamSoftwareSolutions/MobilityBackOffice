import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Todo embebido servido por reverse-proxy necesita su prefijo en DOS lugares:
 * `apps/api/src/main.ts` (donde vive el proxy) y el `server.proxy` de Vite.
 *
 * Falta uno solo y el sintoma es engañoso: **en dev el navegador entra por Vite**, no
 * por el API. Lo que Vite no conoce cae en su fallback SPA y devuelve `index.html`, así
 * que el iframe muestra **BackOffice dentro de BackOffice** — sin ningún error, ni en el
 * navegador ni en los logs.
 *
 * Ese fue exactamente el bug de `/waba`: el proxy del backend estaba bien y probado con
 * curl contra `:3010`, pero faltaba la entrada en Vite y por `:5183` se auto-embebía.
 *
 * Se lee el archivo como texto en vez de importar la config porque `defineConfig`
 * arrastra los plugins de React y no vale la pena montarlos para esta comprobación.
 */
const viteConfig = readFileSync(
  resolve(__dirname, '../../vite.config.ts'),
  'utf8',
);

/** Prefijos que el backend sirve por reverse-proxy. Sumar acá cada embebido nuevo. */
const PREFIJOS_EMBEBIDOS = ['/rag', '/waba'];

describe('proxy del dev server — los embebidos no deben caer en el fallback SPA', () => {
  it.each(PREFIJOS_EMBEBIDOS)('%s está declarado en el proxy de Vite', (prefijo) => {
    expect(viteConfig).toContain(`'${prefijo}': {`);
  });

  it.each(PREFIJOS_EMBEBIDOS)('%s apunta al API, no a otro lado', (prefijo) => {
    // El bloque del prefijo, hasta su llave de cierre.
    const desde = viteConfig.indexOf(`'${prefijo}': {`);
    const bloque = viteConfig.slice(desde, viteConfig.indexOf('}', desde));
    expect(bloque).toContain('http://localhost:3010');
  });

  it('/api sigue proxyado: es la base de todo lo demás', () => {
    expect(viteConfig).toContain("'/api': {");
  });
});
