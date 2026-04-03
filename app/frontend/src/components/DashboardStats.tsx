import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Clock, AlertTriangle, Ban, LayoutGrid } from 'lucide-react';

interface Room {
  id: number;
  status: string;
}

interface DashboardStatsProps {
  rooms: Room[];
}

export default function DashboardStats({ rooms }: DashboardStatsProps) {
  const total = rooms.length;
  const completed = rooms.filter((r) => r.status === 'completed').length;
  const inProgress = rooms.filter((r) => r.status === 'in_progress').length;
  const blocked = rooms.filter((r) => r.status === 'blocked').length;
  const readyForInspection = rooms.filter((r) => r.status === 'ready_for_inspection').length;
  const notStarted = rooms.filter((r) => r.status === 'not_started').length;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const stats = [
    { label: 'Total', value: total, icon: LayoutGrid, color: 'text-slate-600', bg: 'bg-slate-100' },
    { label: 'Completed', value: completed, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100' },
    { label: 'In Progress', value: inProgress, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-100' },
    { label: 'Inspection', value: readyForInspection, icon: AlertTriangle, color: 'text-blue-600', bg: 'bg-blue-100' },
    { label: 'Blocked', value: blocked, icon: Ban, color: 'text-red-600', bg: 'bg-red-100' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-2 text-center">
            <div className={`mx-auto w-8 h-8 rounded-full ${stat.bg} flex items-center justify-center mb-1`}>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </div>
            <div className="text-lg font-bold">{stat.value}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">{stat.label}</div>
          </Card>
        ))}
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Overall Progress</span>
          <span className="font-bold text-emerald-600">{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-3" />
      </div>
    </div>
  );
}