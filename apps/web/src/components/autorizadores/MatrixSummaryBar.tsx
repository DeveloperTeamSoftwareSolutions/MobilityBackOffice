import { MatrixFilter, MatrixSummary } from './autorizadores.types';

/**
 * Semáforo de la sociedad.
 *
 * Es lo que hoy no se ve consultando la base: un autorizador puede estar cargado y aun
 * así no poder firmar (banda 0/0, rango inválido) o no alcanzar ningún CEBE vigente.
 * Eso no se descubre hasta que un gerente no puede aprobar y llama a soporte.
 *
 * Cada contador es además un filtro: contarlo sin poder verlo obligaría a buscar a mano.
 * El resumen se calcula sobre la sociedad completa, así que no cambia al filtrar.
 */
export function MatrixSummaryBar({
  summary,
  filter,
  onFilter,
}: {
  summary: MatrixSummary;
  filter: MatrixFilter;
  onFilter: (filter: MatrixFilter) => void;
}) {
  const cards: {
    key: MatrixFilter;
    label: string;
    value: number;
    hint: string;
    tone: 'neutral' | 'warn' | 'danger';
  }[] = [
    {
      key: 'all',
      label: 'Autorizadores',
      value: summary.total,
      hint: 'En la matriz de esta sociedad',
      tone: 'neutral',
    },
    {
      key: 'blocked',
      label: 'No pueden firmar',
      value: summary.blocked,
      hint: 'La banda cargada no los habilita',
      tone: summary.blocked > 0 ? 'danger' : 'neutral',
    },
    {
      key: 'inactive-cebes',
      label: 'Sin CEBE vigente',
      value: summary.withoutActiveProfitCenters,
      hint: 'Sin asignación que cubra hoy',
      tone: summary.withoutActiveProfitCenters > 0 ? 'warn' : 'neutral',
    },
    {
      key: 'whole-company',
      label: 'Toda la sociedad',
      value: summary.wholeCompany,
      hint: 'Firman sin restricción de CEBE',
      tone: 'neutral',
    },
  ];

  return (
    <div className="bo-az__summary">
      {cards.map((card) => {
        const active = filter === card.key;
        return (
          <button
            key={card.key}
            type="button"
            className={`bo-az__card bo-az__card--${card.tone}${active ? ' bo-az__card--active' : ''}`}
            aria-pressed={active}
            onClick={() => onFilter(active && card.key !== 'all' ? 'all' : card.key)}
          >
            <span className="bo-az__cardvalue">{card.value}</span>
            <span className="bo-az__cardlabel">{card.label}</span>
            <span className="bo-az__cardhint">{card.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
