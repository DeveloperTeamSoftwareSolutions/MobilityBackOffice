import { useState } from 'react';
import './waba-frame.css';

/**
 * Panel de WhatsApp (WABA) embebido.
 *
 * El iframe apunta a `/waba/` — mismo origen que BackOffice — porque el backend hace
 * reverse-proxy hacia el panel. Es la única vía: WABA manda `X-Frame-Options: SAMEORIGIN`
 * y CSP `frame-ancestors 'self'`, así que un iframe directo desde otro origen se bloquea.
 *
 * La sesión de BackOffice viaja por la cookie httpOnly `bo_waba_token` (scopeada a
 * `/waba`), que el backend setea en el login; el proxy exige rol Marketing o SuperAdmin.
 *
 * **WABA tiene su propio login**, y ese guard no lo reemplaza: evita que BackOffice sea
 * un proxy abierto hacia su pantalla de acceso. Adentro del iframe la primera pantalla es
 * el login del panel, con sus propios usuarios, roles y selector de cuenta. No hay SSO
 * entre las dos apps por ahora — el aviso lo dice de entrada, en vez de dejar a alguien
 * preguntándose por qué le piden credenciales otra vez.
 */
export function WabaPanel() {
  const [avisoVisible, setAvisoVisible] = useState(true);

  return (
    <div className="bo-waba-wrap">
      {avisoVisible && (
        <div className="bo-waba-notice">
          <span className="bo-waba-notice__text">
            El panel de WhatsApp tiene <strong>su propio usuario y contraseña</strong>, distintos
            de los de BackOffice. Si es la primera vez, vas a ver su pantalla de acceso.
          </span>
          <button
            type="button"
            className="bo-waba-notice__close"
            onClick={() => setAvisoVisible(false)}
          >
            Entendido
          </button>
        </div>
      )}

      <iframe className="bo-waba-frame" src="/waba/" title="Panel de WhatsApp (WABA)" />
    </div>
  );
}
