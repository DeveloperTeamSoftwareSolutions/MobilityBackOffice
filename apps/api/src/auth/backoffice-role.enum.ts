/**
 * Roles de negocio de Mobility BackOffice.
 * Se derivan de los RoleKey asignados en ITManager (app MobilityBackOffice),
 * no del email ni del perfil SAP.
 */
export enum BackOfficeRole {
  /** Acceso total al back-office. */
  SuperAdmin = 'SuperAdmin',
  /** Consola de soporte: auditar y corregir ordenes/cotizaciones (DevelopersTeam). */
  Soporte = 'Soporte',
  /**
   * Todo el back-office MENOS la consola de soporte.
   *
   * No es "SuperAdmin sin la consola": es el rol para quien trabaja con las
   * herramientas del dia a dia (Regiones, Marketing) sin acceso a la consola, que
   * altera documentos del flujo y queda restringida al DevelopersTeam.
   */
  Usuario = 'Usuario',
  /** Regiones comerciales y configuracion. */
  Administrador = 'Administrador',
  /** Templates de WhatsApp y carga de documentacion del RAG. */
  Marketing = 'Marketing',
}
