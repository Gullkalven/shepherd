import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { useProjectList } from '@/contexts/ProjectListContext';
import { usePermissions } from '@/lib/permissions';
import DashboardStats from '@/components/DashboardStats';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogForm } from '@/components/ui/dialog';
import { Plus, Layers, Trash2, BarChart3, ChevronRight, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  computeFloorPhaseProgress,
  DEFAULT_PHASE_WORKFLOW,
  type FloorPhaseProgressEntry,
  type PhaseWorkflowEntry,
} from '@/lib/roomPhases';
import { taskCountsForFloorBoard } from '@/lib/roomAreas';
import { useI18n } from '@/lib/i18n';
import { useDesktopAutoFocus } from '@/lib/useDesktopAutoFocus';
import { apiFailureMessage, devLogApiFailure, httpStatusFromError } from '@/lib/apiErrors';
import { shepherdDebug } from '@/lib/shepherdDebug';
import {
  parseProjectRouteParam,
  unwrapProjectBody,
  type ProjectRecord,
} from '@/lib/projectEntity';
import { clearWorkerLastRoomIfMatchesProject } from '@/lib/workerLastRoom';
import { flashProjectNotFoundOnce } from '@/lib/projectNotFoundFlash';
import { clearStoredSelectedProjectIfMatches } from '@/lib/selectedProjectStorage';
import {
  HEATING_CABLE_STAGES,
  buildHeatingCableGallerySections,
  heatingExtraStepRowVisible,
  formatHeatingCableDateTimeReadable,
  normalizeHeatingCableDoc,
} from '@/lib/heatingCable';

/** Compact labels for default phases; other keys use first letter */
function phaseProgressLetter(key: string): string {
  const m: Record<string, string> = {
    demontering: 'D',
    varmekabel: 'V',
    remontering: 'R',
    sluttkontroll: 'S',
  };
  return m[key] ?? (key.charAt(0) || '?').toUpperCase();
}

interface Floor {
  id: number;
  floor_number: number;
  name?: string;
}

interface Room {
  id: number;
  status: string;
  floor_id: number;
  room_number: string;
  assigned_worker?: string;
  updated_at?: string | null;
  phase?: string;
  areas?: unknown;
  heating_cable_doc?: unknown;
}

interface RoomPhoto {
  id: number;
  room_id: number;
  object_key: string;
  user_id?: string;
  caption?: string | null;
  downloadUrl?: string;
  created_at?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseUploadedByFromCaption(caption: string | null | undefined): string {
  if (!caption) return '';
  const marker = 'Uploaded by ';
  const idx = caption.indexOf(marker);
  if (idx < 0) return '';
  return caption.slice(idx + marker.length).split(' · ')[0]?.trim() || '';
}

async function downscaleImageForPdf(url: string): Promise<string> {
  const MAX_SIDE = 1600;
  const JPEG_QUALITY = 0.78;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.crossOrigin = 'anonymous';
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('image load failed'));
      node.src = url;
    });
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) return url;
    const scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return url;
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } catch {
    return url;
  }
}

interface ProjectTaskRow {
  room_id: number;
  phase?: string | null;
  is_completed?: boolean | null;
  area_id?: string | null;
}

type Project = ProjectRecord;

export default function ProjectDetail() {
  const desktopAutoFocus = useDesktopAutoFocus();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { allowedProjectIds, ready: projectListReady } = useProjectList();
  const { canCreateFloor, canDeleteFloor, canEdit, isWorker } = usePermissions();
  const [project, setProject] = useState<Project | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [projectTasks, setProjectTasks] = useState<ProjectTaskRow[]>([]);
  const [phaseWorkflow, setPhaseWorkflow] = useState<PhaseWorkflowEntry[]>(DEFAULT_PHASE_WORKFLOW);
  const [showCreate, setShowCreate] = useState(false);
  const [floorNumber, setFloorNumber] = useState('');
  const [floorName, setFloorName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showHeatingExport, setShowHeatingExport] = useState(false);
  const [heatingExportRoomIds, setHeatingExportRoomIds] = useState<number[]>([]);
  const [exportingHeatingPdf, setExportingHeatingPdf] = useState(false);
  const [loading, setLoading] = useState(true);
  /** Non-404 failure — show retry without pretending the project exists. */
  const [loadError, setLoadError] = useState(false);
  const { t } = useI18n();

  // Inline edit state for project name
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [editProjectNameVal, setEditProjectNameVal] = useState('');

  // Inline edit state for floor names
  const [editingFloorId, setEditingFloorId] = useState<number | null>(null);
  const [editFloorName, setEditFloorName] = useState('');

  const reloadProjectState = useCallback(async () => {
    const parsed = parseProjectRouteParam(projectId);
    if (parsed === null) {
      toast.error('Invalid project link.');
      navigate('/', { replace: true });
      throw new Error('invalid project route');
    }

    const projRes = await client.entities.projects.get({ id: String(parsed) });
    const row = unwrapProjectBody(projRes?.data);
    if (!row) {
      devLogApiFailure('ProjectDetail.unwrapProject', new Error('missing project payload'));
      throw Object.assign(new Error('Projects not found'), { response: { status: 404 } });
    }

    const resolvedId = row.id;
    const [floorsRes, roomsRes, tasksRes] = await Promise.all([
      client.entities.floors.query({
        query: { project_id: resolvedId },
        sort: 'floor_number',
        limit: 100,
      }),
      client.entities.rooms.query({
        query: { project_id: resolvedId },
        limit: 500,
      }),
      client.entities.tasks.query({ limit: 2000, sort: 'room_id' }),
    ]);

    let wf: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW;
    try {
      const wfRes = await client.apiCall.invoke({
        url: `/api/v1/projects/${resolvedId}/workflow`,
        method: 'GET',
        data: {},
      });
      const rawPhases = wfRes?.data?.phases;
      if (Array.isArray(rawPhases) && rawPhases.length > 0) {
        const parsedPhases = rawPhases
          .filter((p: { key?: string; label?: string }) => p?.key && p?.label)
          .map((p: { key: string; label: string }) => ({ key: String(p.key), label: String(p.label) }));
        if (parsedPhases.length > 0) wf = parsedPhases;
      }
    } catch (wfErr) {
      devLogApiFailure('ProjectDetail.workflow', wfErr);
    }

    setProject({ id: resolvedId, name: row.name });
    setFloors(floorsRes?.data?.items || []);
    const roomItems: Room[] = roomsRes?.data?.items || [];
    setAllRooms(roomItems);
    setProjectTasks((tasksRes?.data?.items || []) as ProjectTaskRow[]);
    setPhaseWorkflow(wf);
    if (import.meta.env.DEV) {
      shepherdDebug('ProjectDetail.loaded', { routeParam: projectId, resolvedId });
    }
  }, [projectId, navigate]);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    const parsedRoute = parseProjectRouteParam(projectId);
    if (parsedRoute === null) return;
    if (projectListReady && !allowedProjectIds.has(parsedRoute)) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(false);
    try {
      await reloadProjectState();
    } catch (err) {
      devLogApiFailure('ProjectDetail.loadData', err);
      const st = httpStatusFromError(err);
      const msg = apiFailureMessage(err) ?? 'Failed to load project';
      if (st === 404) {
        const pid = parseProjectRouteParam(projectId);
        if (pid !== null) {
          clearWorkerLastRoomIfMatchesProject(pid);
          clearStoredSelectedProjectIfMatches(pid);
        }
        flashProjectNotFoundOnce();
        navigate('/', { replace: true });
        return;
      }
      toast.error(msg);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [projectId, reloadProjectState, navigate, projectListReady, allowedProjectIds]);

  useEffect(() => {
    setFloors([]);
    setAllRooms([]);
    setProjectTasks([]);
    setPhaseWorkflow(DEFAULT_PHASE_WORKFLOW);
    setProject(null);
    setLoadError(false);
  }, [projectId]);

  useEffect(() => {
    void loadData();
    // Only the route project id should trigger a refetch (avoids retry loops from unstable callback identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleCreateFloor = async () => {
    if (!floorNumber.trim() || !project?.id) return;
    setCreating(true);
    try {
      await client.entities.floors.create({
        data: {
          project_id: project.id,
          floor_number: Number(floorNumber),
          name: floorName.trim() || `Floor ${floorNumber}`,
        },
      });
      setShowCreate(false);
      setFloorNumber('');
      setFloorName('');
      try {
        await reloadProjectState();
        toast.success('Floor added');
      } catch (reloadErr) {
        devLogApiFailure('ProjectDetail.reloadAfterFloorCreate', reloadErr);
        toast.error(
          apiFailureMessage(reloadErr) ??
            'Floor was saved but the project could not be refreshed. Try reloading the page.'
        );
      }
    } catch (err) {
      devLogApiFailure('ProjectDetail.createFloor', err);
      toast.error(apiFailureMessage(err) ?? 'Failed to create floor');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteFloor = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm('Delete this floor and all its rooms?')) return;
    try {
      const floorRooms = allRooms.filter((r) => r.floor_id === id);
      for (const room of floorRooms) {
        await client.entities.rooms.delete({ id: String(room.id) });
      }
      await client.entities.floors.delete({ id: String(id) });
      toast.success('Floor deleted');
      loadData();
    } catch {
      toast.error('Failed to delete floor');
    }
  };

  const getRoomCountsForFloor = (floorId: number) => {
    const floorRooms = allRooms.filter((r) => r.floor_id === floorId);
    const completed = floorRooms.filter((r) => r.status === 'completed').length;
    return { total: floorRooms.length, completed };
  };

  const floorPhaseProgressByFloorId = useMemo(() => {
    const map = new Map<number, FloorPhaseProgressEntry[]>();
    const projectRoomIds = new Set(allRooms.map((r) => r.id));
    const tasksInProject = projectTasks.filter((t) => projectRoomIds.has(Number(t.room_id)));
    const tasksForBoard = tasksInProject.filter((t) => {
      const roomRow = allRooms.find((r) => r.id === Number(t.room_id));
      if (!roomRow) return false;
      return taskCountsForFloorBoard(t.area_id, roomRow.areas);
    });
    for (const floor of floors) {
      const floorRooms = allRooms.filter((r) => r.floor_id === floor.id);
      const floorRoomIds = new Set(floorRooms.map((r) => r.id));
      const floorTasks = tasksForBoard.filter((t) => floorRoomIds.has(Number(t.room_id)));
      map.set(floor.id, computeFloorPhaseProgress(floorRooms, floorTasks, phaseWorkflow));
    }
    return map;
  }, [floors, allRooms, projectTasks, phaseWorkflow]);

  const startEditProjectName = () => {
    if (!project) return;
    setEditingProjectName(true);
    setEditProjectNameVal(project.name);
  };

  const saveProjectName = async () => {
    if (!project || !editProjectNameVal.trim()) {
      setEditingProjectName(false);
      return;
    }
    try {
      await client.entities.projects.update({
        id: String(project.id),
        data: { name: editProjectNameVal.trim() },
      });
      setProject({ ...project, name: editProjectNameVal.trim() });
      toast.success('Project name updated');
    } catch {
      toast.error('Failed to update project name');
    }
    setEditingProjectName(false);
  };

  const startEditFloor = (e: React.MouseEvent, floor: Floor) => {
    e.stopPropagation();
    setEditingFloorId(floor.id);
    setEditFloorName(floor.name || `Floor ${floor.floor_number}`);
  };

  const saveFloorName = async (floorId: number) => {
    if (!editFloorName.trim()) {
      setEditingFloorId(null);
      return;
    }
    try {
      await client.entities.floors.update({
        id: String(floorId),
        data: { name: editFloorName.trim() },
      });
      setFloors((prev) =>
        prev.map((f) => (f.id === floorId ? { ...f, name: editFloorName.trim() } : f))
      );
      toast.success('Floor name updated');
    } catch {
      toast.error('Failed to update floor name');
    }
    setEditingFloorId(null);
  };

  const cancelEditFloor = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingFloorId(null);
    setEditFloorName('');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-dvh bg-slate-50 dark:bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full space-y-4 p-6 text-center">
          <p className="text-muted-foreground">Could not load this project.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button type="button" className="h-11 rounded-xl" onClick={() => void loadData()}>
              Retry
            </Button>
            <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => navigate('/')}>
              All projects
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  const routeProjectPath = `/project/${project.id}`;

  const heatingRooms = allRooms.filter((r) => {
    const doc = normalizeHeatingCableDoc(r.heating_cable_doc);
    return HEATING_CABLE_STAGES.some((s) => Boolean(doc[s.key]));
  });

  const toggleHeatingRoom = (roomId: number) => {
    setHeatingExportRoomIds((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]
    );
  };

  const handleOpenHeatingExport = () => {
    setHeatingExportRoomIds(heatingRooms.map((r) => r.id));
    setShowHeatingExport(true);
  };

  const exportHeatingDocumentation = async () => {
    if (!project || heatingExportRoomIds.length === 0) {
      toast.error('Select at least one room');
      return;
    }
    setExportingHeatingPdf(true);
    try {
      const roomById = new Map(allRooms.map((r) => [r.id, r]));
      const floorById = new Map(floors.map((f) => [f.id, f]));
      const selectedRooms = heatingExportRoomIds
        .map((id) => roomById.get(id))
        .filter((r): r is Room => Boolean(r));

      const roomPhotos = new Map<number, RoomPhoto[]>();
      const photoById = new Map<number, RoomPhoto>();
      await Promise.all(
        selectedRooms.map(async (room) => {
          try {
            const res = await client.entities.room_photos.query({
              query: { room_id: room.id },
              sort: '-created_at',
              limit: 500,
            });
            const baseItems = Array.isArray(res?.data?.items) ? (res.data.items as RoomPhoto[]) : [];
            const items = await Promise.all(
              baseItems.map(async (photo) => {
                try {
                  const dlRes = await client.storage.getDownloadUrl({
                    bucket_name: 'room-photos',
                    object_key: photo.object_key,
                  });
                  return {
                    ...photo,
                    downloadUrl:
                      typeof dlRes?.data?.download_url === 'string' ? dlRes.data.download_url : photo.downloadUrl,
                  };
                } catch {
                  return photo;
                }
              })
            );
            roomPhotos.set(room.id, items);
            for (const photo of items) photoById.set(photo.id, photo);
          } catch {
            roomPhotos.set(room.id, []);
          }
        })
      );

      const preparedPhotoUrlById = new Map<number, string>();
      const photoUrlTasks: Promise<void>[] = [];
      const sections = selectedRooms
        .map((room) => {
          const doc = normalizeHeatingCableDoc(room.heating_cable_doc);
          const photos = roomPhotos.get(room.id) ?? [];
          const gallery = buildHeatingCableGallerySections(doc, photos);
          const floor = floorById.get(room.floor_id);
          const floorLabel = floor?.name || `Floor ${floor?.floor_number ?? room.floor_id}`;
          const stageRows: Array<{ id: string; label: string; row: Record<string, unknown> }> = [
            ...HEATING_CABLE_STAGES.map((s) => ({
              id: s.key,
              label: s.label,
              row: ((doc[s.key] || {}) as Record<string, unknown>) ?? {},
            })),
            ...((doc.extra_steps || [])
              .map((step, idx) => {
                const sid = (step.id && String(step.id).trim()) || `extra-${idx}`;
                return {
                  id: sid,
                  label: step.label?.trim() || `Extra step ${idx + 1}`,
                  row: (step as Record<string, unknown>) ?? {},
                  visible: heatingExtraStepRowVisible(step),
                };
              })
              .filter((x) => x.visible)
              .map(({ id, label, row }) => ({ id, label, row }))),
          ];
          return `
            <section class="room">
              <h2>Room ${escapeHtml(room.room_number)}</h2>
              <p><strong>Project:</strong> ${escapeHtml(project.name)}</p>
              <p><strong>Floor/Room:</strong> ${escapeHtml(floorLabel)} / ${escapeHtml(room.room_number)}</p>
              ${stageRows
                .map((stage) => {
                  const completedBy =
                    stage.row.completed_by_name?.trim() ||
                    stage.row.completed_by?.trim() ||
                    stage.row.performed_by?.trim() ||
                    '-';
                  const registeredAt = formatHeatingCableDateTimeReadable(
                    stage.row.completed_at?.trim() || stage.row.date?.trim() || ''
                  );
                  const stagePhotos = gallery.find((g) => g.stageId === stage.id)?.items || [];
                  const fallbackPhotos = gallery.find((g) => g.label === stage.label)?.items || [];
                  const items = stagePhotos.length > 0 ? stagePhotos : fallbackPhotos;
                  const docFieldPhotos = Array.isArray(stage.row.photos)
                    ? stage.row.photos.filter((x) => typeof x === 'string' && x.trim())
                    : [];
                  const sourceUsed =
                    stagePhotos.length > 0
                      ? `gallery.stageId:${stage.id}`
                      : fallbackPhotos.length > 0
                        ? `gallery.label:${stage.label}`
                        : docFieldPhotos.length > 0
                          ? `heating_cable_doc.${stage.id}.photos`
                          : 'none';
                  console.info('[HeatingPdfExport] stage photos', {
                    roomId: room.id,
                    stepKey: stage.id,
                    photoCount: items.length,
                    sourcePath: sourceUsed,
                  });
                  const photoCards = items
                    .filter((x) => x.displayUrl)
                    .map((x) => {
                      if (typeof x.photoId === 'number') {
                        photoUrlTasks.push(
                          downscaleImageForPdf(x.displayUrl).then((prepared) => {
                            preparedPhotoUrlById.set(x.photoId!, prepared);
                          })
                        );
                      }
                      const meta = typeof x.photoId === 'number' ? photoById.get(x.photoId) : undefined;
                      const uploadedBy =
                        parseUploadedByFromCaption(meta?.caption ?? null) || meta?.user_id?.trim() || '';
                      const uploadedAt = formatHeatingCableDateTimeReadable(meta?.created_at || '');
                      const details = [
                        uploadedBy ? `<span>Uploaded by: ${escapeHtml(uploadedBy)}</span>` : '',
                        uploadedAt ? `<span>Recorded: ${escapeHtml(uploadedAt)}</span>` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      return `
                        <figure class="photo-card" data-photo-id="${x.photoId ?? ''}">
                          <img src="${escapeHtml(x.displayUrl)}" alt="${escapeHtml(stage.label)}" />
                          ${details ? `<figcaption>${details}</figcaption>` : ''}
                        </figure>
                      `;
                    })
                    .join('');
                  return `
                    <div class="stage">
                      <h3>${escapeHtml(stage.label)}</h3>
                      <p><strong>Resistance:</strong> ${escapeHtml(stage.row.resistance_ohm || '-')}</p>
                      <p><strong>Insulation:</strong> ${escapeHtml(stage.row.insulation_mohm || '-')}</p>
                      <p><strong>Registered:</strong> ${escapeHtml(registeredAt || '-')}</p>
                      <p><strong>Performed/Confirmed by:</strong> ${escapeHtml(completedBy)}</p>
                      ${
                        items.length > 0
                          ? `<div class="photos">${photoCards}</div>`
                          : '<p class="muted">No photos uploaded</p>'
                      }
                    </div>
                  `;
                })
                .join('')}
            </section>
          `;
        })
        .join('');

      await Promise.all(photoUrlTasks);

      const w = window.open('', '_blank');
      if (!w) throw new Error('Popup blocked');
      w.document.write(`
        <html>
          <head>
            <title>Heating Cable Documentation - ${project.name}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; }
              h1 { margin-bottom: 20px; }
              .room { page-break-after: always; margin-bottom: 24px; }
              .stage { border: 1px solid #ddd; border-radius: 8px; padding: 10px; margin: 10px 0; }
              .photos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
              .photo-card { margin: 0; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; break-inside: avoid; page-break-inside: avoid; background: #fff; }
              .photo-card img { display: block; width: 100%; max-height: 220px; object-fit: cover; }
              .photo-card figcaption { padding: 6px 8px; font-size: 11px; color: #444; }
              .muted { color: #666; font-style: italic; }
            </style>
          </head>
          <body>
            <h1>Heating Cable Documentation</h1>
            ${sections}
          </body>
        </html>
      `);
      for (const [photoId, preparedUrl] of preparedPhotoUrlById.entries()) {
        const imgNodes = w.document.querySelectorAll(`img[data-photo-id="${photoId}"], figure[data-photo-id="${photoId}"] img`);
        imgNodes.forEach((node) => {
          if (node instanceof HTMLImageElement) node.src = preparedUrl;
        });
      }
      w.document.close();
      w.focus();
      w.print();
      setShowHeatingExport(false);
      toast.success('Export opened. Choose Save as PDF in the print dialog.');
    } catch {
      toast.error('Failed to export heating cable documentation');
    } finally {
      setExportingHeatingPdf(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-background pb-8">
      <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-none lg:px-6 xl:px-8">
        {/* Dashboard — admin/BAS only (hidden for workers on site). */}
        {!isWorker && (
          <>
            <Button
              variant="outline"
              className="w-full justify-between h-12 rounded-xl"
              onClick={() => setShowDashboard(!showDashboard)}
            >
              <span className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#1E3A5F] dark:text-blue-400" />
                {t('dashboard')}
              </span>
              <ChevronRight className={`h-4 w-4 transition-transform ${showDashboard ? 'rotate-90' : ''}`} />
            </Button>

            {showDashboard && (
              <Card className="p-4">
                <DashboardStats rooms={allRooms} />
                <div className="mt-3">
                  <Button type="button" variant="outline" className="h-10" onClick={handleOpenHeatingExport}>
                    Export heating cable PDF
                  </Button>
                </div>
              </Card>
            )}
          </>
        )}

        {/* Project Name (editable) */}
        <div className="flex items-center gap-2 group/projname">
          {editingProjectName ? (
            <div className="flex items-center gap-2 flex-1">
              <Input
                value={editProjectNameVal}
                onChange={(e) => setEditProjectNameVal(e.target.value)}
                className="h-9 text-lg font-bold"
                {...(desktopAutoFocus ? { autoFocus: true } : {})}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveProjectName();
                  if (e.key === 'Escape') setEditingProjectName(false);
                }}
                onBlur={() => saveProjectName()}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-emerald-500 hover:text-emerald-700"
                onMouseDown={(e) => { e.preventDefault(); saveProjectName(); }}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-slate-400 hover:text-slate-600"
                onMouseDown={(e) => { e.preventDefault(); setEditingProjectName(false); }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-bold text-slate-800 dark:text-foreground">{project?.name || 'Project'}</h2>
              {canEdit && (
                <button
                  className="opacity-0 group-hover/projname:opacity-100 transition-opacity text-slate-400 hover:text-blue-500 p-0.5"
                  onClick={startEditProjectName}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        {/* Site worker management lives in Admin Settings → Site Workers. */}

        {/* Floors */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800 dark:text-foreground">Floors</h2>
          {canCreateFloor && (
            <Button
              onClick={() => setShowCreate(true)}
              className="bg-[#1E3A5F] hover:bg-[#2a4f7a] dark:bg-blue-600 dark:hover:bg-blue-700 h-10 rounded-xl"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Floor
            </Button>
          )}
        </div>

        {floors.length === 0 ? (
          <Card className="p-8 text-center space-y-4">
            <Layers className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-muted-foreground">No floors yet</p>
            {canCreateFloor && (
              <>
                <p className="text-sm text-muted-foreground">
                  Add a floor, then open it to create rooms and checklist tasks.
                </p>
                <Button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="bg-[#1E3A5F] hover:bg-[#2a4f7a] dark:bg-blue-600 dark:hover:bg-blue-700 h-10 rounded-xl"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add floor
                </Button>
              </>
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            {floors.map((floor) => {
              const counts = getRoomCountsForFloor(floor.id);
              return (
                <Card
                  key={floor.id}
                  className="p-4 shepherd-interactive-card"
                  onClick={() =>
                    editingFloorId !== floor.id && navigate(`${routeProjectPath}/floor/${floor.id}`)
                  }
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      {editingFloorId === floor.id ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Input
                            value={editFloorName}
                            onChange={(e) => setEditFloorName(e.target.value)}
                            className="h-9 text-base sm:text-sm font-semibold"
                            {...(desktopAutoFocus ? { autoFocus: true } : {})}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveFloorName(floor.id);
                              if (e.key === 'Escape') cancelEditFloor();
                            }}
                            onBlur={() => saveFloorName(floor.id)}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-emerald-500 hover:text-emerald-700"
                            onMouseDown={(e) => { e.preventDefault(); saveFloorName(floor.id); }}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-slate-400 hover:text-slate-600"
                            onMouseDown={(e) => { e.preventDefault(); cancelEditFloor(); }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 group/flname">
                          <h3 className="font-semibold text-slate-800 dark:text-foreground">
                            {floor.name || `Floor ${floor.floor_number}`}
                          </h3>
                          {canEdit && (
                            <button
                              className="opacity-0 group-hover/flname:opacity-100 transition-opacity text-slate-400 hover:text-blue-500 p-0.5"
                              onClick={(e) => startEditFloor(e, floor)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                      {editingFloorId !== floor.id && (
                        <>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {counts.total} rooms · {counts.completed} completed
                          </p>
                          {(floorPhaseProgressByFloorId.get(floor.id) ?? []).length > 0 && (
                            <p
                              className="mt-1 text-xs leading-snug text-muted-foreground tabular-nums"
                              title="Checklist progress per phase: rooms with all items in that phase done / rooms on floor"
                            >
                              {(floorPhaseProgressByFloorId.get(floor.id) ?? []).map((row) => (
                                <span key={row.key} className="mr-2 inline-block">
                                  {phaseProgressLetter(row.key)}: {row.completedRooms}/{row.totalRooms}
                                </span>
                              ))}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    {editingFloorId !== floor.id && (
                      <div className="flex items-center gap-1">
                        {canDeleteFloor && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                            onClick={(e) => handleDeleteFloor(e, floor.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                        <ChevronRight className="h-5 w-5 text-slate-400 dark:text-slate-500" />
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm mx-4">
          <DialogForm onSubmit={(e) => { e.preventDefault(); handleCreateFloor(); }}>
            <DialogHeader>
              <DialogTitle>Add Floor</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                type="number"
                placeholder="Floor number (e.g., 1, 2, 3)"
                value={floorNumber}
                onChange={(e) => setFloorNumber(e.target.value)}
                className="h-12"
              />
              <Input
                placeholder="Floor name (optional)"
                value={floorName}
                onChange={(e) => setFloorName(e.target.value)}
                className="h-12"
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={!floorNumber.trim() || creating}
                className="w-full bg-[#1E3A5F] hover:bg-[#2a4f7a] dark:bg-blue-600 dark:hover:bg-blue-700 h-12"
              >
                {creating ? 'Adding...' : 'Add Floor'}
              </Button>
            </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      <Dialog open={showHeatingExport} onOpenChange={setShowHeatingExport}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Select rooms for heating cable PDF</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-border p-2">
            {heatingRooms.map((room) => (
              <label key={room.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={heatingExportRoomIds.includes(room.id)}
                  onChange={() => toggleHeatingRoom(room.id)}
                />
                <span className="text-sm">Room {room.room_number}</span>
              </label>
            ))}
            {heatingRooms.length === 0 ? (
              <p className="text-sm text-muted-foreground px-2 py-1">No rooms with heating cable documentation.</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowHeatingExport(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void exportHeatingDocumentation()} disabled={exportingHeatingPdf}>
              {exportingHeatingPdf ? 'Preparing…' : 'Export PDF'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}