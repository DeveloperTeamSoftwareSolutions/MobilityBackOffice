import {
  isRegionGroup,
  expandRegionCode,
  listRegionGroups,
  REGION_GROUPS,
} from './region-groups';

describe('region-groups', () => {
  describe('isRegionGroup', () => {
    it('reconoce CAYCAR como agrupacion', () => {
      expect(isRegionGroup('CAYCAR')).toBe(true);
    });

    it('una region atomica no es agrupacion', () => {
      expect(isRegionGroup('CA')).toBe(false);
    });

    it('tolera espacios alrededor', () => {
      expect(isRegionGroup('  CAYCAR  ')).toBe(true);
    });

    it('el string vacio no es agrupacion', () => {
      expect(isRegionGroup('')).toBe(false);
    });

    it('no confunde propiedades heredadas de Object con agrupaciones', () => {
      expect(isRegionGroup('constructor')).toBe(false);
      expect(isRegionGroup('toString')).toBe(false);
    });
  });

  describe('expandRegionCode', () => {
    it('expande CAYCAR a sus miembros', () => {
      expect(expandRegionCode('CAYCAR')).toEqual(['CA', 'CB']);
    });

    it('una region atomica se expande a si misma', () => {
      expect(expandRegionCode('AN')).toEqual(['AN']);
    });

    it('el string vacio se expande a lista vacia', () => {
      expect(expandRegionCode('')).toEqual([]);
      expect(expandRegionCode('   ')).toEqual([]);
    });

    it('devuelve una copia: mutar el resultado no altera la configuracion', () => {
      const miembros = expandRegionCode('CAYCAR');
      miembros.push('XX');
      expect(REGION_GROUPS.CAYCAR).toEqual(['CA', 'CB']);
    });
  });

  describe('listRegionGroups', () => {
    it('lista las agrupaciones con nombre y miembros', () => {
      expect(listRegionGroups()).toEqual([
        {
          code: 'CAYCAR',
          name: 'CAYCAR (Centroamérica + Caribe)',
          members: ['CA', 'CB'],
        },
      ]);
    });
  });
});
