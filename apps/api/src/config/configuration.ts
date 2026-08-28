/**
 * Configuración tipada derivada de las variables de entorno (ya validadas por Joi).
 * Se consume vía ConfigService: `config.get('itmanager.authUrl')`.
 */
export default () => ({
  port: parseInt(process.env.PORT ?? '3010', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5183',

  itmanager: {
    authUrl: process.env.ITMANAGER_AUTH_URL,
    appId: process.env.APP_ID ?? 'MobilityBackOffice',
    permPrefix: process.env.PERM_PREFIX ?? 'MOBILITYBO_',
  },

  // MobilityMiddleWare — único componente que conecta a SQL Server. BackOffice consume
  // sus endpoints por HTTP (regiones, CEBEs, sociedades, auditoría) en vez de pegarle a
  // la base. `url` ya incluye el prefijo `/api`. `apiKey` es opcional: el middleware no
  // exige auth si su propia env está vacía (no-op). Ver docs/EXTERNAL_APIS.md.
  middleware: {
    url: process.env.MIDDLEWARE_URL ?? 'http://localhost:6002/api',
    apiKey: process.env.MIDDLEWARE_API_KEY,
  },

  // Token PROPIO de BackOffice. No es el de ManageIT y no comparte su secret:
  // el JWT de ManageIT no incluye los roleKeys, así que la autorización en runtime
  // se degradaría a `isAdmin`, que es global y cruza aplicaciones.
  jwt: {
    secret: process.env.BACKOFFICE_JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  },

  // Regiones comerciales — key del web service de sync (x-api-key). Vacío = deshabilitado.
  regions: {
    syncApiKey: process.env.REGIONS_SYNC_API_KEY,
  },

  // DuwyEngineRAG — cargador de documentacion embebido via reverse-proxy same-origin.
  // Sin URL, el proxy /rag no se monta y la seccion no carga.
  rag: {
    url: process.env.RAG_URL,
  },

  // Panel WABA (WhatsApp Business Cloud API). Se embebe por reverse-proxy same-origin
  // igual que el RAG: manda X-Frame-Options SAMEORIGIN y CSP frame-ancestors self, asi
  // que un iframe directo se bloquea. Sin URL, el proxy /waba no se monta.
  waba: {
    url: process.env.WABA_URL,
  },
});
