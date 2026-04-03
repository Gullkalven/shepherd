# Construction Site Production Management - Development Plan

## Design Guidelines

### Design References
- **Trello**: Kanban board layout and card-based UI
- **Style**: Industrial Modern, Mobile-First, Clean & Functional

### Color Palette
- Primary: #1E3A5F (Deep Navy - headers, primary actions)
- Secondary: #F59E0B (Amber/Construction Yellow - accents, highlights)
- Success: #10B981 (Green - completed status)
- Warning: #F59E0B (Amber - in progress)
- Danger: #EF4444 (Red - blocked)
- Info: #3B82F6 (Blue - ready for inspection)
- Background: #F8FAFC (Light gray)
- Card: #FFFFFF (White)
- Text: #1E293B (Dark slate), #64748B (Muted)

### Typography
- Font: Inter (system fallback)
- Headings: font-weight 700
- Body: font-weight 400

### Key Component Styles
- Cards: White bg, rounded-xl, shadow-sm, border
- Buttons: Large tap targets (min 44px), rounded-lg
- Status badges: Colored pills with icons
- Checkboxes: Large (24px) for easy tapping

## Files to Create

1. **src/pages/Index.tsx** - Landing/Projects list page (login + project CRUD)
2. **src/pages/ProjectDetail.tsx** - Floors list for a project + Dashboard stats
3. **src/pages/FloorDetail.tsx** - Rooms list for a floor + Kanban view toggle
4. **src/pages/RoomDetail.tsx** - Room card with tasks, photos, comments, status
5. **src/components/KanbanBoard.tsx** - Drag-and-drop Kanban board for rooms
6. **src/components/DashboardStats.tsx** - Progress statistics for foreman
7. **src/components/Header.tsx** - App header with navigation breadcrumbs
8. **src/App.tsx** - Updated routing

## Data Flow
- Projects → Floors → Rooms → Tasks/Photos
- All data via web-sdk client.entities.*
- Photos via client.storage.* with bucket "room-photos"
- Standard checklist auto-created when room is created