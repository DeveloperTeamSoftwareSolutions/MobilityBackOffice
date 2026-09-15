import {
  extractPlaceholders,
  mapTemplate,
  parseButtons,
  parseJsonSafe,
  parseVariables,
  summarizeByStatus,
} from './templates.util';
import { Template, WabaTemplateRow } from './templates.types';

function row(over: Partial<WabaTemplateRow> = {}): WabaTemplateRow {
  return {
    Id: 1,
    Name: 'template_reminder',
    Language: 'es_MX',
    Category: 'MARKETING',
    Status: 'APPROVED',
    HeaderType: null,
    HeaderContent: null,
    BodyText: 'Hola {{1}}, te recordamos tu cita.',
    FooterText: null,
    ButtonsJson: null,
    ComponentsJson: null,
    VariablesJson: null,
    ...over,
  };
}

/**
 * WABA guarda botones y variables como JSON DENTRO de una columna de texto, y ese texto
 * puede venir vacio, nulo o mal formado (plantillas viejas sincronizadas de META). Un
 * `JSON.parse` suelto tumbaria la pantalla entera por una sola fila con un dato viejo.
 */
describe('parseJsonSafe', () => {
  it('parsea JSON valido', () => {
    expect(parseJsonSafe<number[]>('[1,2]')).toEqual([1, 2]);
  });

  it('devuelve null ante JSON roto en vez de tirar', () => {
    expect(parseJsonSafe('{ esto no es json')).toBeNull();
  });

  it('trata vacio, null y la cadena "null" como ausencia', () => {
    expect(parseJsonSafe('')).toBeNull();
    expect(parseJsonSafe('   ')).toBeNull();
    expect(parseJsonSafe(null)).toBeNull();
    expect(parseJsonSafe(undefined)).toBeNull();
    expect(parseJsonSafe('null')).toBeNull();
  });
});

describe('parseButtons', () => {
  it('mapea los botones al DTO', () => {
    const json = JSON.stringify([
      { type: 'URL', text: 'Ver más', url: 'https://duwest.com' },
      { type: 'PHONE_NUMBER', text: 'Llamar', phone_number: '+50212345678' },
    ]);
    expect(parseButtons(json)).toEqual([
      { type: 'URL', text: 'Ver más', url: 'https://duwest.com', phoneNumber: null },
      { type: 'PHONE_NUMBER', text: 'Llamar', url: null, phoneNumber: '+50212345678' },
    ]);
  });

  it('acepta `title` como alias de `text`', () => {
    expect(parseButtons('[{"type":"QUICK_REPLY","title":"Sí"}]')[0].text).toBe('Sí');
  });

  it('sin botones devuelve array vacio, no null', () => {
    // Una plantilla sin botones es lo normal: la UI no deberia tener que chequear null.
    expect(parseButtons(null)).toEqual([]);
    expect(parseButtons('')).toEqual([]);
  });

  it('un JSON roto no rompe: devuelve vacio', () => {
    expect(parseButtons('[{roto')).toEqual([]);
  });

  it('ignora entradas que no son objetos', () => {
    expect(parseButtons('["texto", null, 42]')).toEqual([]);
  });

  it('si el JSON no es un array, devuelve vacio', () => {
    expect(parseButtons('{"type":"URL"}')).toEqual([]);
  });
});

describe('extractPlaceholders', () => {
  it('encuentra los {{n}} en orden', () => {
    expect(extractPlaceholders('Hola {{1}}, tu pedido {{2}} llego')).toEqual(['1', '2']);
  });

  it('soporta variables con nombre', () => {
    expect(extractPlaceholders('Hola {{nombre}}')).toEqual(['nombre']);
  });

  it('tolera espacios dentro de las llaves', () => {
    expect(extractPlaceholders('Hola {{ 1 }}')).toEqual(['1']);
  });

  it('no repite la misma variable', () => {
    expect(extractPlaceholders('{{1}} y de nuevo {{1}}')).toEqual(['1']);
  });

  it('sin variables devuelve vacio', () => {
    expect(extractPlaceholders('Texto sin variables')).toEqual([]);
    expect(extractPlaceholders(null)).toEqual([]);
  });

  it('no toma llaves vacias', () => {
    expect(extractPlaceholders('Esto {{}} no cuenta')).toEqual([]);
  });
});

describe('parseVariables', () => {
  it('usa VariablesJson cuando esta cargado', () => {
    expect(parseVariables('["nombre","fecha"]', 'Hola {{1}}')).toEqual(['nombre', 'fecha']);
  });

  it('acepta objetos con `name`', () => {
    expect(parseVariables('[{"name":"cliente"}]', null)).toEqual(['cliente']);
  });

  it('CAE al texto cuando VariablesJson falta', () => {
    // Las plantillas sincronizadas de META antes de que WABA guardara esa columna no la
    // traen. Sin el fallback, la pantalla daria a entender que se envian tal cual.
    expect(parseVariables(null, 'Hola {{1}}, cita el {{2}}')).toEqual(['1', '2']);
  });

  it('CAE al texto cuando VariablesJson viene roto', () => {
    expect(parseVariables('[roto', 'Hola {{1}}')).toEqual(['1']);
  });

  it('CAE al texto cuando VariablesJson es un array vacio', () => {
    expect(parseVariables('[]', 'Hola {{1}}')).toEqual(['1']);
  });
});

describe('mapTemplate', () => {
  it('mapea una plantilla completa', () => {
    const t = mapTemplate(row()) as Template;
    expect(t).toMatchObject({
      id: 1,
      name: 'template_reminder',
      language: 'es_MX',
      category: 'MARKETING',
      status: 'APPROVED',
      variables: ['1'],
      buttons: [],
    });
  });

  it('descarta una fila sin nombre: no identifica ninguna plantilla', () => {
    expect(mapTemplate(row({ Name: null }))).toBeNull();
    expect(mapTemplate(row({ Name: '   ' }))).toBeNull();
  });

  it('normaliza estado y categoria a mayusculas', () => {
    const t = mapTemplate(row({ Status: 'approved', Category: 'marketing' })) as Template;
    expect(t.status).toBe('APPROVED');
    expect(t.category).toBe('MARKETING');
  });

  it('un estado desconocido queda en null, no se inventa', () => {
    // Si META agrega un estado nuevo, es preferible mostrarlo como "sin estado" antes
    // que hacerlo pasar por uno conocido.
    expect((mapTemplate(row({ Status: 'ALGO_NUEVO' })) as Template).status).toBeNull();
  });

  it('los textos vacios quedan en null', () => {
    const t = mapTemplate(row({ FooterText: '   ', HeaderContent: '' })) as Template;
    expect(t.footerText).toBeNull();
    expect(t.headerContent).toBeNull();
  });
});

describe('summarizeByStatus', () => {
  const t = (status: Template['status']): Template =>
    ({ ...(mapTemplate(row()) as Template), status });

  it('cuenta por estado', () => {
    const out = summarizeByStatus([t('APPROVED'), t('APPROVED'), t('PENDING')]);
    expect(out).toEqual({ APPROVED: 2, PENDING: 1 });
  });

  it('las que no tienen estado van a SIN_ESTADO', () => {
    expect(summarizeByStatus([t(null)])).toEqual({ SIN_ESTADO: 1 });
  });

  it('sin plantillas devuelve un resumen vacio', () => {
    expect(summarizeByStatus([])).toEqual({});
  });
});
