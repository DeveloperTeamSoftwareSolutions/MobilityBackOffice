import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PlaceholderPage } from './pages/PlaceholderPage';

/**
 * Router de la aplicación. Punto único donde se declaran los módulos.
 *
 * Fase 0: solo el esqueleto. El login (AuthProvider + ProtectedRoute) llega en la
 * fase 3 y las rutas de negocio se cuelgan de AppLayout a partir de la fase 5.
 */
export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PlaceholderPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
