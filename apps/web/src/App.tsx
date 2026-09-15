import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { RoleGuard } from './auth/RoleGuard';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { RegionesPage } from './pages/RegionesPage';
import { RagPage } from './pages/RagPage';
import { PlantillasPage } from './pages/PlantillasPage';
import { SoportePage } from './pages/SoportePage';
import { AutorizadoresPage } from './pages/AutorizadoresPage';

/**
 * Router de la aplicación. Punto único donde se declaran los módulos.
 *
 * Los RoleGuard de acá son cosméticos (evitan mostrar lo que el backend
 * rechazaría); la autorización real vive en el `RolesGuard` de la API.
 */
export function App(): JSX.Element {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<HomePage />} />

            <Route
              path="regiones-comerciales"
              element={
                <RoleGuard
                  allow={['Administrador']}
                  fallback={<Navigate to="/" replace />}
                >
                  <RegionesPage />
                </RoleGuard>
              }
            />

            <Route
              path="templates-whatsapp"
              element={
                <RoleGuard
                  allow={['Marketing']}
                  fallback={<Navigate to="/" replace />}
                >
                  <PlantillasPage />
                </RoleGuard>
              }
            />

            <Route
              path="documentacion-rag"
              element={
                <RoleGuard
                  allow={['Marketing']}
                  fallback={<Navigate to="/" replace />}
                >
                  <RagPage />
                </RoleGuard>
              }
            />

            <Route
              path="matriz-autorizadores"
              element={
                <RoleGuard
                  allow={['SuperAdmin']}
                  fallback={<Navigate to="/" replace />}
                >
                  <AutorizadoresPage />
                </RoleGuard>
              }
            />

            <Route
              path="soporte"
              element={
                <RoleGuard
                  allow={['Soporte']}
                  fallback={<Navigate to="/" replace />}
                >
                  <SoportePage />
                </RoleGuard>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
