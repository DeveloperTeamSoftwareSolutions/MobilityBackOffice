/**
 * Iconos SVG inline. Sin librería de iconos: son pocos y así no se agrega una
 * dependencia ni una fuente externa que el CSP tendría que permitir.
 */

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 16 16',
  fill: 'currentColor',
  'aria-hidden': true,
} as const;

export function IconDashboard() {
  return (
    <svg {...base}>
      <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z" />
    </svg>
  );
}

export function IconRegions() {
  return (
    <svg {...base}>
      <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM4.5 7.5a3.5 3.5 0 0 1 7 0c0 .38-.06.75-.17 1.09L8 14 4.67 8.59A3.49 3.49 0 0 1 4.5 7.5zM8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
    </svg>
  );
}

export function IconChatSquare() {
  return (
    <svg {...base}>
      <path d="M14 1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4.414A2 2 0 0 0 3 12.586l-2 2V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353l2.853-2.853A1 1 0 0 1 4.414 12H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z" />
    </svg>
  );
}

export function IconFileText() {
  return (
    <svg {...base}>
      <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4zm5 1.5V5h3.5L9 1.5zM4.5 8h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1zm0 2.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1zm0-5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1z" />
    </svg>
  );
}

export function IconMenu() {
  return (
    <svg {...base}>
      <path d="M2.5 4h11a.5.5 0 0 0 0-1h-11a.5.5 0 0 0 0 1zm0 4.5h11a.5.5 0 0 0 0-1h-11a.5.5 0 0 0 0 1zm0 4.5h11a.5.5 0 0 0 0-1h-11a.5.5 0 0 0 0 1z" />
    </svg>
  );
}

/**
 * Consola de soporte. Reloj: la seccion se organiza alrededor de la linea de
 * tiempo de un documento, asi que el glifo apunta al historico, no a la llave
 * inglesa (que sugeriria configuracion).
 */
export function IconSupport() {
  return (
    <svg {...base}>
      <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z" />
      <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z" />
    </svg>
  );
}

/** Información contextual: acompaña a un texto corto y guarda el detalle. */
export function IconInfo() {
  return (
    <svg {...base} width={14} height={14}>
      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
      <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z" />
    </svg>
  );
}
