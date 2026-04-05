import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { ThemeProvider } from '@/lib/theme';
import { DevPresentationSessionProvider } from '@/lib/devPresentationSession';
import Index from './pages/Index';
import AuthCallback from './pages/AuthCallback';
import AuthError from './pages/AuthError';
import AppShellLayout from './layouts/AppShellLayout';
import ProjectDetail from './pages/ProjectDetail';
import FloorDetail from './pages/FloorDetail';
import RoomDetail from './pages/RoomDetail';
import AdminUsers from './pages/AdminUsers';
import NotFound from './pages/NotFound';

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
          <DevPresentationSessionProvider>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/error" element={<AuthError />} />
            <Route path="/" element={<AppShellLayout />}>
              <Route index element={<Index />} />
              <Route path="admin/users" element={<AdminUsers />} />
              <Route path="project/:projectId" element={<Outlet />}>
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
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;