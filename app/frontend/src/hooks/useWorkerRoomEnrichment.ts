import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '@/lib/api';

interface SiteRow {
  id: number;
  name: string;
}

interface FloorRow {
  id: number;
  floor_number: number;
  project_id: number;
  name?: string;
}

interface RoomRow {
  id: number;
  floor_id: number;
  room_number: string;
  status: string;
  updated_at?: string | null;
  phase?: string | null;
}

export interface TaskRow {
  room_id: number;
  name?: string;
  is_completed?: boolean | null;
}

export type EnrichedRoom = {
  projectId: number;
  projectName: string;
  projectOrder: number;
  floorId: number;
  floorNumber: number;
  id: number;
  room_number: string;
  status: string;
  updated_at?: string | null;
  phase?: string | null;
};

const TASKS_QUERY_LIMIT = 2000;

function sortRooms(a: EnrichedRoom, b: EnrichedRoom): number {
  if (a.projectOrder !== b.projectOrder) return a.projectOrder - b.projectOrder;
  if (a.floorNumber !== b.floorNumber) return a.floorNumber - b.floorNumber;
  const byNum = String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true });
  return byNum !== 0 ? byNum : a.id - b.id;
}

export function useWorkerRoomEnrichment(
  sites: SiteRow[],
  sitesLoading: boolean,
  hasUser: boolean
) {
  const [roomsFlat, setRoomsFlat] = useState<EnrichedRoom[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);
  const [taskSummaryUnavailable, setTaskSummaryUnavailable] = useState(false);
  const enrichmentSeq = useRef(0);

  const loadEnrichment = useCallback(async () => {
    if (!hasUser) {
      setRoomsFlat([]);
      setTasks([]);
      setTaskSummaryUnavailable(false);
      setEnrichmentLoading(false);
      return;
    }

    if (sitesLoading || sites.length === 0) {
      setRoomsFlat([]);
      setTasks([]);
      setTaskSummaryUnavailable(false);
      setEnrichmentLoading(false);
      return;
    }

    const seq = ++enrichmentSeq.current;
    setEnrichmentLoading(true);
    setTaskSummaryUnavailable(false);

    try {
      try {
        const tasksRes = await client.entities.tasks.query({
          limit: TASKS_QUERY_LIMIT,
          sort: 'room_id',
        });
        if (seq !== enrichmentSeq.current) return;
        setTasks((tasksRes?.data?.items || []) as TaskRow[]);
      } catch (err) {
        console.error('[Worker enrichment] tasks summary failed', err);
        if (seq !== enrichmentSeq.current) return;
        setTasks([]);
        setTaskSummaryUnavailable(true);
      }

      const enriched: EnrichedRoom[] = [];
      const plist = sites;
      for (let i = 0; i < plist.length; i++) {
        const p = plist[i];
        try {
          const [floorsRes, roomsRes] = await Promise.all([
            client.entities.floors.query({
              query: { project_id: p.id },
              sort: 'floor_number',
              limit: 100,
            }),
            client.entities.rooms.query({
              query: { project_id: p.id },
              limit: 500,
            }),
          ]);
          const floors = (floorsRes?.data?.items || []) as FloorRow[];
          const floorById = new Map(floors.map((f) => [f.id, f]));
          const rlist = (roomsRes?.data?.items || []) as RoomRow[];
          for (const r of rlist) {
            const fl = floorById.get(r.floor_id);
            if (!fl) continue;
            enriched.push({
              projectId: p.id,
              projectName: p.name,
              projectOrder: i,
              floorId: fl.id,
              floorNumber: fl.floor_number,
              id: r.id,
              room_number: r.room_number,
              status: r.status,
              updated_at: r.updated_at,
              phase: r.phase ?? null,
            });
          }
        } catch (err) {
          console.error('[Worker enrichment] floors/rooms for project failed', p.id, err);
        }
      }
      if (seq !== enrichmentSeq.current) return;
      enriched.sort(sortRooms);
      setRoomsFlat(enriched);
    } finally {
      if (seq === enrichmentSeq.current) {
        setEnrichmentLoading(false);
      }
    }
  }, [hasUser, sites, sitesLoading]);

  useEffect(() => {
    void loadEnrichment();
  }, [loadEnrichment]);

  return {
    roomsFlat,
    tasks,
    enrichmentLoading,
    taskSummaryUnavailable,
    reloadEnrichment: loadEnrichment,
  };
}
