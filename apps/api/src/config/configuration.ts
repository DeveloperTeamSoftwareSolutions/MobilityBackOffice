/**
 * Configuración tipada derivada de las variables de entorno (ya validadas por Joi).
 * Se consume vía ConfigService: `config.get('itmanager.authUrl')`.
 */
export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  itmanager: {
    authUrl: process.env.ITMANAGER_AUTH_URL,
    appId: process.env.APP_ID ?? 'MobilityBackOffice',
    permPrefix: process.env.PERM_PREFIX ?? 'MOBILITYBO_',
    jwtSecret: process.env.JWT_SECRET,
  },

  // Regiones comerciales — key del web service de sync (x-api-key). Vacío = deshabilitado.
  regions: {
    syncApiKey: process.env.REGIONS_SYNC_API_KEY,
  },
});
