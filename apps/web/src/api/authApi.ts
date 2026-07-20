import { httpClient } from './httpClient';
import type { LoginResponse } from '../types';

interface ApiError {
  response?: { data?: { message?: string | string[] } };
}

/** Extrae el mensaje del backend; el ValidationPipe devuelve un array. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as ApiError)?.response?.data?.message;
  if (Array.isArray(message)) return message.join('. ');
  if (typeof message === 'string') return message;
  return fallback;
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const { data } = await httpClient.post<LoginResponse>('/api/auth/login', {
    email,
    password,
  });
  return data;
}
