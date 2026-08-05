import * as Joi from 'joi';

/**
 * Esquema de validación de variables de entorno.
 * Falla el arranque si falta una variable requerida o tiene formato inválido.
 */
export const envValidationSchema = Joi.object({
  // Servidor
  PORT: Joi.number().default(3010),
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  CORS_ORIGIN: Joi.string().default('http://localhost:5183'),

  // MobilityMiddleWare — único componente que conecta a SQL Server. BackOffice consume
  // sus endpoints por HTTP (regiones, CEBEs, sociedades, auditoría). La URL ya incluye
  // el prefijo `/api`. La key es opcional: si el middleware no la exige, es no-op.
  MIDDLEWARE_URL: Joi.string().uri().default('http://localhost:6002/api'),
  MIDDLEWARE_API_KEY: Joi.string().allow('').optional(),

  // ITManager — autoridad de credenciales y de roles asignados
  ITMANAGER_AUTH_URL: Joi.string().uri().required(),
  APP_ID: Joi.string().default('MobilityBackOffice'),
  PERM_PREFIX: Joi.string().default('MOBILITYBO_'),

  // Token propio de BackOffice (HS256). Secret PROPIO, distinto del de ManageIT:
  // firmamos el rol de la app dentro del token porque el JWT de ManageIT no lleva
  // los roleKeys. Ver docs/AUTENTICACION.md.
  BACKOFFICE_JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),

  // Regiones comerciales — key del web service de sync (x-api-key). Si no está
  // seteada, el endpoint POST /api/regions/sync queda deshabilitado (403).
  REGIONS_SYNC_API_KEY: Joi.string().allow('').optional(),

  // DuwyEngineRAG — base URL del cargador de documentacion a embeber. Sin ella, el
  // proxy /rag no se monta y la seccion queda deshabilitada.
  RAG_URL: Joi.string().uri().optional(),
});
