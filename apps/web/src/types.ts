/** Espejo de `BackOfficeRole` del backend (apps/api/src/auth/backoffice-role.enum.ts). */
export type BackOfficeRole =
  | 'SuperAdmin'
  | 'Soporte'
  /** Todo el back-office menos la consola de soporte. */
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
