import { type ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '@/lib/permissions';

/**
 * Provisional admin PIN + account admins only. Site worker PIN sessions cannot use admin routes.
 */
export default function RequireAdminAccess({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { loading, isAdmin, sessionIsPinWorker } = usePermissions();

  useEffect(() => {
    if (loading) return;
    if (sessionIsPinWorker) {
      navigate('/worker/rooms', { replace: true });
      return;
    }
    if (!isAdmin) {
      navigate('/admin/login', { replace: true });
    }
  }, [loading, isAdmin, sessionIsPinWorker, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 dark:bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F] border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  if (sessionIsPinWorker || !isAdmin) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 dark:bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F] border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  return children;
}
