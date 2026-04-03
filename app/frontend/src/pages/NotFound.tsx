import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { HardHat } from 'lucide-react';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <HardHat className="h-16 w-16 text-slate-300 mb-4" />
      <h1 className="text-2xl font-bold text-slate-800 mb-2">Page Not Found</h1>
      <p className="text-muted-foreground mb-6">The page you're looking for doesn't exist.</p>
      <Button onClick={() => navigate('/')} className="bg-[#1E3A5F] hover:bg-[#2a4f7a]">
        Back to Projects
      </Button>
    </div>
  );
}