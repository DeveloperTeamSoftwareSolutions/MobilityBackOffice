/**
 * Categorias de `AuditLogs`, la tabla central que BackOffice comparte con ITManager y
 * MobilityManager.
 *
 * **Por que capitalizadas.** El buscador de auditoria de ITManager arma su desplegable de
 * categorias con lo que hay en la tabla (`SELECT DISTINCT Category`), no con una lista
 * fija, asi que una categoria propia aparece sola. Pero si BackOffice escribe `auth` y
 * ITManager escribe `Auth`, el desplegable muestra **dos entradas que se leen igual** y no
 * hay forma de saber cual es cual. El formato tiene que coincidir aunque el valor no.
 *
 * **Por que `Auth` se comparte y el resto no.** Un login es un login venga de donde venga:
 * conviene que caigan todos juntos y que `AppId` diga de que app vino. Regiones, soporte y
 * plantillas no existen en ITManager, asi que tienen la suya — llamarlas `Apps` o `System`
 * para reusar su vocabulario las volveria imposibles de encontrar.
 */
export enum AuditCategory {
  /** Accesos. La comparte con ITManager: los logins quedan todos juntos. */
  Auth = 'Auth',
  /** Regiones comerciales por CEBE. */
  Regions = 'Regions',
  /** Consola de soporte: decisiones sobre cotizaciones y pedidos. */
  Support = 'Support',
  /** Plantillas de WhatsApp. Lo que sale hacia META. */
  Templates = 'Templates',
}
