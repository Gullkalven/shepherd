"""
Verify sync-rooms only touches phases that already use this template (no cross-phase pollution).

Run from app/backend:  PYTHONPATH=. python3 scripts/verify_sync_phase_scoping.py
"""
from __future__ import annotations

import os
import sys

os.environ.setdefault("LOCAL_DEV_AUTH", "true")
os.environ.setdefault("MGX_IGNORE_INIT_DATA", "1")


def main() -> int:
    from fastapi.testclient import TestClient

    from main import app

    host = {"Host": "localhost:8000"}
    c = TestClient(app)

    def j(method: str, url: str, **kw):
        if method == "GET":
            res = c.get(url, headers=host, **kw)
        elif method == "POST":
            res = c.post(url, headers=host, **kw)
        elif method == "PUT":
            res = c.put(url, headers=host, **kw)
        elif method == "DELETE":
            res = c.delete(url, headers=host, **kw)
        else:
            raise ValueError(method)
        if res.status_code >= 400:
            print(res.text)
        res.raise_for_status()
        return res.json() if res.text else {}

    # --- Project, floor, room ---
    proj = j("POST", "/api/v1/entities/projects", json={"name": "Sync test project", "description": ""})
    pid = proj["id"]
    fl = j("POST", "/api/v1/entities/floors", json={"project_id": pid, "floor_number": 1, "name": "F1"})
    floor_id = fl["id"]
    room = j(
        "POST",
        "/api/v1/entities/rooms",
        json={
            "floor_id": floor_id,
            "project_id": pid,
            "room_number": "901",
            "status": "not_started",
            "phase": "demontering",
            "assigned_worker": "",
            "comment": "",
            "blocked_reason": "",
        },
    )
    room_id = room["id"]

    # --- Templates A (demontering) and B (remontering) ---
    ta = j("POST", "/api/v1/entities/checklist_templates", json={"name": "Tmpl_A_Demo"})
    tb = j("POST", "/api/v1/entities/checklist_templates", json={"name": "Tmpl_B_Remont"})
    id_a, id_b = ta["id"], tb["id"]

    ia = j(
        "POST",
        "/api/v1/entities/checklist_template_items",
        json={"template_id": id_a, "name": "A_only_line", "sort_order": 0},
    )
    ib = j(
        "POST",
        "/api/v1/entities/checklist_template_items",
        json={"template_id": id_b, "name": "B_only_line", "sort_order": 0},
    )
    item_a_id = ia["id"]
    item_b_id = ib["id"]

    # --- Room tasks: A in demontering, B in remontering (matches floor creation flow) ---
    j(
        "POST",
        "/api/v1/entities/tasks",
        json={
            "room_id": room_id,
            "name": "A_only_line",
            "is_completed": False,
            "sort_order": 0,
            "template_id": id_a,
            "template_item_id": item_a_id,
            "is_template_managed": True,
            "is_overridden": False,
            "phase": "demontering",
        },
    )
    j(
        "POST",
        "/api/v1/entities/tasks",
        json={
            "room_id": room_id,
            "name": "B_only_line",
            "is_completed": False,
            "sort_order": 0,
            "template_id": id_b,
            "template_item_id": item_b_id,
            "is_template_managed": True,
            "is_overridden": False,
            "phase": "remontering",
        },
    )

    # --- Rename template B line (simulate edit + save template) ---
    j("DELETE", f"/api/v1/entities/checklist_template_items/by-template/{id_b}")
    ib2 = j(
        "POST",
        "/api/v1/entities/checklist_template_items",
        json={"template_id": id_b, "name": "B_UPDATED_AFTER_EDIT", "sort_order": 0},
    )
    new_item_b_id = ib2["id"]

    # --- Sync rooms from remontering template B only ---
    j("POST", f"/api/v1/entities/checklist_templates/{id_b}/sync-rooms", json={})

    # --- Load all tasks for room ---
    import json as _json

    q = _json.dumps({"room_id": room_id})
    lst = j("GET", "/api/v1/entities/tasks", params={"query": q, "limit": 500})

    tasks = lst.get("items") or []

    demo_tasks = [t for t in tasks if (t.get("phase") or "") == "demontering"]
    rem_tasks = [t for t in tasks if (t.get("phase") or "") == "remontering"]

    demo_b = [t for t in demo_tasks if t.get("template_id") == id_b]
    demo_a_names = [t.get("name") for t in demo_tasks if t.get("template_id") == id_a]
    rem_b_names = [t.get("name") for t in rem_tasks if t.get("template_id") == id_b]

    print("--- sync phase scoping verification ---")
    print(f"Template A id={id_a}, Template B id={id_b}")
    print(f"Demontering tasks from template B (should be 0): {len(demo_b)}")
    print(f"Demontering template A names (should stay 'A_only_line'): {demo_a_names}")
    print(f"Remontering template B names (should reflect edit): {rem_b_names}")

    ok = len(demo_b) == 0
    ok = ok and demo_a_names == ["A_only_line"]
    ok = ok and rem_b_names == ["B_UPDATED_AFTER_EDIT"]

    if ok:
        print("RESULT: PASS — remontering template sync did not pollute demontering.")
        return 0
    print("RESULT: FAIL")
    return 1


if __name__ == "__main__":
    sys.exit(main())
