import logging
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from models.section_settings import Section_settings
from models.user_roles import User_roles
from schemas.auth import UserResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/sections", tags=["section_visibility"])

VALID_SECTIONS = {"visit_log", "checklist", "photos", "comments", "status", "assigned_worker"}
VALID_ROLES = {"admin", "manager", "electrician", "apprentice", "worker"}

SECTION_LABELS = {
    "visit_log": "Visit Log",
    "checklist": "Checklist",
    "photos": "Photos",
    "comments": "Comments",
    "status": "Status",
    "assigned_worker": "Assigned Worker",
}


class SectionVisibility(BaseModel):
    role_name: str
    section_key: str
    is_visible: bool


class SectionVisibilityResponse(BaseModel):
    role_name: str
    section_key: str
    section_label: str
    is_visible: bool


class UpdateVisibilityRequest(BaseModel):
    role_name: str
    section_key: str
    is_visible: bool


class BulkUpdateRequest(BaseModel):
    updates: List[UpdateVisibilityRequest]


async def require_admin(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    result = await db.execute(
        select(User_roles).where(User_roles.user_id == str(current_user.id))
    )
    role_record = result.scalar_one_or_none()
    if role_record and role_record.app_role == "admin":
        return current_user
    raise HTTPException(status_code=403, detail="Admin access required")


@router.get("/visibility", response_model=List[SectionVisibilityResponse])
async def get_all_visibility(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all section visibility settings (any authenticated user)."""
    result = await db.execute(select(Section_settings))
    records = result.scalars().all()

    response = []
    for r in records:
        response.append(
            SectionVisibilityResponse(
                role_name=r.role_name,
                section_key=r.section_key,
                section_label=SECTION_LABELS.get(r.section_key, r.section_key),
                is_visible=r.is_visible,
            )
        )

    # Fill in defaults for any missing combinations
    existing = {(r.role_name, r.section_key) for r in response}
    for role in VALID_ROLES:
        for section in VALID_SECTIONS:
            if (role, section) not in existing:
                response.append(
                    SectionVisibilityResponse(
                        role_name=role,
                        section_key=section,
                        section_label=SECTION_LABELS.get(section, section),
                        is_visible=True,
                    )
                )

    return response


@router.get("/visibility/{role_name}", response_model=List[SectionVisibilityResponse])
async def get_role_visibility(
    role_name: str,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get section visibility for a specific role."""
    if role_name not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {role_name}")

    result = await db.execute(
        select(Section_settings).where(Section_settings.role_name == role_name)
    )
    records = result.scalars().all()
    records_map = {r.section_key: r.is_visible for r in records}

    response = []
    for section in VALID_SECTIONS:
        response.append(
            SectionVisibilityResponse(
                role_name=role_name,
                section_key=section,
                section_label=SECTION_LABELS.get(section, section),
                is_visible=records_map.get(section, True),
            )
        )

    return response


@router.post("/visibility/update")
async def update_visibility(
    data: UpdateVisibilityRequest,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update a single section visibility setting (admin only)."""
    if data.role_name not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {data.role_name}")
    if data.section_key not in VALID_SECTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid section: {data.section_key}")

    result = await db.execute(
        select(Section_settings).where(
            and_(
                Section_settings.role_name == data.role_name,
                Section_settings.section_key == data.section_key,
            )
        )
    )
    record = result.scalar_one_or_none()

    if record:
        record.is_visible = data.is_visible
    else:
        record = Section_settings(
            user_id=str(admin.id),
            role_name=data.role_name,
            section_key=data.section_key,
            is_visible=data.is_visible,
        )
        db.add(record)

    await db.commit()
    return {"success": True, "role_name": data.role_name, "section_key": data.section_key, "is_visible": data.is_visible}


@router.post("/visibility/bulk-update")
async def bulk_update_visibility(
    data: BulkUpdateRequest,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Bulk update section visibility settings (admin only)."""
    results = []
    for update in data.updates:
        if update.role_name not in VALID_ROLES or update.section_key not in VALID_SECTIONS:
            continue

        result = await db.execute(
            select(Section_settings).where(
                and_(
                    Section_settings.role_name == update.role_name,
                    Section_settings.section_key == update.section_key,
                )
            )
        )
        record = result.scalar_one_or_none()

        if record:
            record.is_visible = update.is_visible
        else:
            record = Section_settings(
                user_id=str(admin.id),
                role_name=update.role_name,
                section_key=update.section_key,
                is_visible=update.is_visible,
            )
            db.add(record)

        results.append({"role_name": update.role_name, "section_key": update.section_key, "is_visible": update.is_visible})

    await db.commit()
    return {"success": True, "updated": len(results), "results": results}