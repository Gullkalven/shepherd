import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@/lib/theme';
import { DevPresentationSessionProvider } from '@/lib/devPresentationSession';
import { I18nProvider } from '@/lib/i18n';
import Index from './pages/Index';
import AuthCallback from './pages/AuthCallback';
import AuthError from './pages/AuthError';
import AppShellLayout from './layouts/AppShellLayout';
import ProjectDetail from './pages/ProjectDetail';
import FloorDetail from './pages/FloorDetail';
import RoomDetail from './pages/RoomDetail';
import AdminUsers from './pages/AdminUsers';
import AdminLoginPage from './pages/AdminLoginPage';
import WorkerMePage from './pages/WorkerMePage';
import WorkerRoomsPage from './pages/WorkerRoomsPage';
import WorkerLoginPage from './pages/WorkerLoginPage';
import NotFound from './pages/NotFound';
import RequireAdminAccess from './components/RequireAdminAccess';
import AppErrorBoundary from './components/AppErrorBoundary';
import ProjectScopedLayout from './components/ProjectScopedLayout';

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AppErrorBoundary>
      <ThemeProvider>
        <I18nProvider>
          <TooltipProvider>
            <Toaster />
            <BrowserRouter>
              <DevPresentationSessionProvider>
                <Routes>
                  <Route path="/auth/callback" element={<AuthCallback />} />
                  <Route path="/auth/error" element={<AuthError />} />
                  <Route path="/" element={<AppShellLayout />}>
                    <Route index element={<Index />} />
                    <Route path="worker/login" element={<WorkerLoginPage />} />
                    <Route path="worker/rooms" element={<WorkerRoomsPage />} />
                    <Route path="worker/me" element={<Navigate to="/worker/settings" replace />} />
                    <Route path="worker/settings" element={<WorkerMePage />} />
                    <Route path="admin/login" element={<AdminLoginPage />} />
                    <Route
                      path="admin/users"
                      element={
                        <RequireAdminAccess>
                          <AdminUsers />
                        </RequireAdminAccess>
                      }
                    />
                    <Route path="project/:projectId" element={<ProjectScopedLayout />}>
                      <Route index element={<ProjectDetail />} />
                      <Route path="floor/:floorId" element={<FloorDetail />} />
                      <Route path="floor/:floorId/room/:roomId" element={<RoomDetail />} />
                    </Route>
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </DevPresentationSessionProvider>
            </BrowserRouter>
          </TooltipProvider>
        </I18nProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  </QueryClientProvider>
);

export default App;