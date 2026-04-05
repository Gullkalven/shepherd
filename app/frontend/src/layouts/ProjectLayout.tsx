import { Outlet } from 'react-router-dom';
import ProjectNavSidebar from '@/components/ProjectNavSidebar';

/**
 * Desktop-only project shell: fixed left nav + main column. On smaller screens
 * the sidebar is hidden and padding is not applied (unchanged mobile layout).
 */
export default function ProjectLayout() {
  return (
    <>
      <ProjectNavSidebar />
      <div className="min-h-0 lg:pl-56">
        <Outlet />
      </div>
    </>
  );
}
