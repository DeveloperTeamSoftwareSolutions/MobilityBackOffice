import { createContext } from 'react';
import type { BackOfficeRole, User } from '../types';

export interface AuthContextValue {
  user: User | null;
  role: BackOfficeRole | null;
  permissions: string[];
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
