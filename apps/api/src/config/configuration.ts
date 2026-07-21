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
});
