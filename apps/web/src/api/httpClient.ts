import axios from 'axios';

const TOKEN_KEY = 'bo_token';

/**
 * Cliente HTTP del frontend. La baseURL relativa es deliberada: en dev Vite
 * proxya /api al backend (:3000) y en prod el backend sirve el build, así que en
 * ambos casos el mismo origen resuelve. VITE_API_URL debe quedar vacía.
 */
export const httpClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
});

httpClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export { TOKEN_KEY };
