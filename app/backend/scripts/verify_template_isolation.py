"""
Verify checklist template isolation: editing template B must not change template A's items.
Run from app/backend:  PYTHONPATH=. python3 scripts/verify_template_isolation.py
"""
from __future__ import annotations

import os
import sys

# Run with working directory = app/backend
os.environ.setdefault("LOCAL_DEV_AUTH", "true")
os.environ.setdefault("MGX_IGNORE_INIT_DATA", "1")  # avoid mock data noise if set in test


def main() -> int:
    from fastapi.testclient import TestClient

    from main import app

    host = {"Host": "localhost:8000"}
    client = TestClient(app)

    def j(res) -> dict:
        res.raise_for_status()
        return res.json()

    # --- Template A (e.g. demontering) ---
    ta = j(
        client.post(
            "/api/v1/entities/checklist_templates",
            json={"name": "VERIFY_A_Demontering"},
            headers=host,
        )
    )
    id_a = ta["id"]

    for idx, name in enumerate(["D_A_line_1", "D_A_line_2"]):
        j(
            client.post(
                "/api/v1/entities/checklist_template_items",
                json={"template_id": id_a, "name": name, "sort_order": idx},
                headers=host,
            )
        )

    # --- Template B (e.g. remontering) ---
    tb = j(
        client.post(
            "/api/v1/entities/checklist_templates",
            json={"name": "VERIFY_B_Remontering"},
            headers=host,
        )
    )
    id_b = tb["id"]

    for idx, name in enumerate(["R_B_line_1", "R_B_line_2"]):
        j(
            client.post(
                "/api/v1/entities/checklist_template_items",
                json={"template_id": id_b, "name": name, "sort_order": idx},
                headers=host,
            )
        )

    def names_for(template_id: int) -> list[str]:
        body = j(
            client.get(
                f"/api/v1/entities/checklist_template_items/by-template/{template_id}",
                params={"sort": "sort_order", "limit": 2000},
                headers=host,
            )
        )
        items = body.get("items") or []
        return [str(x["name"]) for x in sorted(items, key=lambda i: (i.get("sort_order") or 0, i["id"]))]

    before_a = names_for(id_a)
    before_b = names_for(id_b)

    # --- Edit ONLY template B (same steps as FloorDetail handleSaveTemplate) ---
    j(
        client.put(
            f"/api/v1/entities/checklist_templates/{id_b}",
            json={"name": "VERIFY_B_Remontering_UPDATED"},
            headers=host,
        )
    )
    j(
        client.delete(
            f"/api/v1/entities/checklist_template_items/by-template/{id_b}",
            headers=host,
        )
    )
    for idx, name in enumerate(["R_B_ONLY_NEW_1", "R_B_ONLY_NEW_2"]):
        j(
            client.post(
                "/api/v1/entities/checklist_template_items",
                json={"template_id": id_b, "name": name, "sort_order": idx},
                headers=host,
            )
        )

    after_a = names_for(id_a)
    after_b = names_for(id_b)

    print("--- Template isolation verification ---")
    print(f"Template A id={id_a} names before edit: {before_a}")
    print(f"Template A id={id_a} names after  edit: {after_a}")
    print(f"Template B id={id_b} names before edit: {before_b}")
    print(f"Template B id={id_b} names after  edit: {after_b}")
    print()

    ok = before_a == after_a and before_a == ["D_A_line_1", "D_A_line_2"]
    ok = ok and after_b == ["R_B_ONLY_NEW_1", "R_B_ONLY_NEW_2"]

    if ok:
        print("RESULT: PASS — Template A unchanged; only Template B was updated.")
        return 0

    print("RESULT: FAIL")
    if before_a != after_a:
        print("  Template A lines changed; they must stay identical.")
    if after_b != ["R_B_ONLY_NEW_1", "R_B_ONLY_NEW_2"]:
        print("  Template B did not end in the expected state (check API errors above).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
