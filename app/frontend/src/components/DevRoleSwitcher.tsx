import { useEffect, useState } from 'react';
import {
  DEV_ROLE_CHANGED_EVENT,
  DEV_ROLE_OPTIONS,
  type DevAppRole,
  applyDevRole,
  isDevRoleSwitcherHost,
  readDevRoleFromStorage,
} from '@/lib/devRole';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function DevRoleSwitcher() {
  const [role, setRole] = useState<DevAppRole>(() => readDevRoleFromStorage());

  useEffect(() => {
    const sync = () => setRole(readDevRoleFromStorage());
    window.addEventListener(DEV_ROLE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(DEV_ROLE_CHANGED_EVENT, sync);
  }, []);

  if (!isDevRoleSwitcherHost()) return null;

  return (
    <div
      className="flex max-w-[min(52vw,14rem)] shrink-0 items-center gap-1.5"
      title="Development only: switch role stored in localStorage"
    >
      <span className="hidden text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:inline">
        Role
      </span>
      <Select
        value={role}
        onValueChange={(v) => {
          const next = v as DevAppRole;
          applyDevRole(next);
          setRole(next);
        }}
      >
        <SelectTrigger
          className="h-8 w-full min-w-0 border-input bg-background px-2 text-xs text-foreground"
          aria-label="Development role"
        >
          <SelectValue placeholder="Role" />
        </SelectTrigger>
        <SelectContent className="z-[100]">
          {DEV_ROLE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
