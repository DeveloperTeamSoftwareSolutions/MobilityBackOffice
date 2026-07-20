/**
 * Roles de negocio de Mobility BackOffice.
 * Se derivan de los RoleKey asignados en ITManager (app MobilityBackOffice),
 * no del email ni del perfil SAP.
 */
export enum BackOfficeRole {
  /** Acceso total al back-office. */
  SuperAdmin = 'SuperAdmin',
  /** Regiones comerciales y configuracion. */
  Administrador = 'Administrador',
  /** Templates de WhatsApp y carga de documentacion del RAG. */
  Marketing = 'Marketing',
}
