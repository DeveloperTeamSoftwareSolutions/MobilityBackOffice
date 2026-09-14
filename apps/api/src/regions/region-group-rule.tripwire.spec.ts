import * as fs from 'fs';
import * as path from 'path';

/**
 * UNA SOLA DEFINICIÓN DE LAS AGRUPACIONES DE REGIONES — la de la base.
 *
 * CAYCAR (y cualquier agrupación futura) se define en la vista
 * `dbo.VIEW_RegionGroupProfitCenters` (repo MobilityMiddleWare, `sql/`), y el middleware
 * (≥ 1.331.0) la sirve: `/mobility/regions/groups` y `resolve?codes=CAYCAR`. MobilityManager
 * y DuwyDashy leen la misma vista.
 *
 * Hasta api 2.15.0 BackOffice tenía SU PROPIA copia de la regla (`region-groups.ts`:
 * `CAYCAR` con miembros CA y CB resuelto como unión). Dos definiciones de la misma regla en
 * dos lenguajes divergen en silencio: el negocio decidió que CAYCAR es la intersección por
 * código de CEBE, la vista lo refleja, y una copia local seguía mostrando la unión sin que
 * nada fallara. Una segunda definición ES la clase de bug que se eliminó.
 *
 * Este test mira el CÓDIGO FUENTE de la API (no los tests) y falla si reaparece una
 * definición local: el nombre del modo de combinación o un arreglo con los miembros de una
 * agrupación. Si de verdad hace falta cambiar la regla, se cambia la vista — no se agrega
 * una copia acá.
 */
describe('tripwire: BackOffice no define reglas de agrupación de regiones', () => {
  const SRC = path.join(__dirname, '..');

  /** Archivos `.ts` de la app que NO son tests. */
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sourceFiles(full));
      else if (/\.ts$/.test(entry.name) && !/\.(spec|test)\.ts$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  /** Lo que delata una regla de agrupación escrita en BackOffice. */
  const RULE_PATTERNS: { name: string; re: RegExp }[] = [
    { name: "el modo 'intersection-by-code'", re: /intersection-by-code/ },
    // ['CA', 'CB'] / ["CA","CB"] / ['CB','CA'] / [`CA`, `CB`], con cualquier espaciado.
    { name: 'un arreglo de miembros CA + CB', re: /\[\s*(['"`])(CA|CB)\1\s*,\s*(['"`])(CA|CB)\3\s*\]/ },
  ];

  const files = sourceFiles(SRC);

  it('hay código que revisar (si esto falla, el propio test se quedó ciego)', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((f) => f.endsWith(path.join('regions', 'regions.service.ts')))).toBe(true);
    expect(files.some((f) => /\.spec\.ts$/.test(f))).toBe(false);
  });

  it('los patrones detectan la regla que se sacó (si no, el tripwire no protege nada)', () => {
    const unionVieja = "CAYCAR: ['CA', 'CB'],";
    const interseccionLocal = "CAYCAR: { members: ['CA', 'CB'], mode: 'intersection-by-code' },";
    expect(unionVieja).toMatch(RULE_PATTERNS[1].re);
    for (const p of RULE_PATTERNS) expect(interseccionLocal).toMatch(p.re);
    expect('members: ["CB","CA"]').toMatch(RULE_PATTERNS[1].re);
    expect('members: [`CA` , `CB`]').toMatch(RULE_PATTERNS[1].re);
    // Un arreglo con otras regiones no es la regla de CAYCAR.
    expect("['CA', 'AN']").not.toMatch(RULE_PATTERNS[1].re);
  });

  it.each(files.map((f) => [path.relative(SRC, f), f]))(
    '%s no hardcodea una regla de agrupación',
    (rel, file) => {
      const src = fs.readFileSync(file as string, 'utf8');
      for (const p of RULE_PATTERNS) {
        if (p.re.test(src)) {
          throw new Error(
            `${rel} contiene ${p.name}: las agrupaciones se definen en dbo.VIEW_RegionGroupProfitCenters, no en BackOffice`,
          );
        }
      }
    },
  );
});
