/** Espejo de `BackOfficeRole` del backend (apps/api/src/auth/backoffice-role.enum.ts). */
export type BackOfficeRole =
  | 'SuperAdmin'
  | 'Soporte'
  /** Revisión de órdenes rechazadas por SAP. Se asigna deliberadamente. */
  | 'RevisionSap'
  /** Todo el back-office menos la consola de soporte y lo que se asigna deliberadamente. */
  | 'Usuario'
  | 'Administrador'
  | 'Marketing';

export interface User {
  email: string;
  name: string;
  guidUsers: string;
}

export interface LoginResponse {
  success: true;
  token: string;
  user: User;
  role: BackOfficeRole;
  permissions: string[];
}
