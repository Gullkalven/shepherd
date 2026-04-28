import logging
import ipaddress
from pathlib import Path
from urllib.parse import urlparse

from dependencies.auth import get_admin_user, get_current_user
from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
import httpx
from schemas.auth import UserResponse
from schemas.storage import (
    BucketListResponse,
    BucketRequest,
    BucketResponse,
    DeleteResponse,
    FileUpDownRequest,
    FileUpDownResponse,
    ObjectInfo,
    ObjectListResponse,
    ObjectRequest,
    OSSBaseModel,
    RenameRequest,
    RenameResponse,
)
from services.storage import StorageService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/storage", tags=["storage"])
LOCAL_STORAGE_ROOT = Path(__file__).resolve().parents[1] / "local_storage"


def _is_internal_target_url(target_url: str) -> bool:
    try:
        parsed = urlparse(target_url)
        host = (parsed.hostname or "").strip().lower()
        if host in {"localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal", "minio", "storage", "oss"}:
            return True
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        return False


@router.post("/create-bucket", response_model=BucketResponse)
async def create_bucket(request: BucketRequest, _current_user: UserResponse = Depends(get_admin_user)):
    """
    Create a new bucket
    """
    try:
        service = StorageService()
        return await service.create_bucket(request)
    except ValueError as e:
        logger.error(f"Invalid create bucket request: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create bucket: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"{e}")


@router.get("/list-buckets", response_model=BucketListResponse)
async def list_buckets(_current_user: UserResponse = Depends(get_current_user)):
    """
    List buckets of the user
    """
    try:
        service = StorageService()
        return await service.list_buckets()
    except ValueError as e:
        logger.error(f"Invalid list buckets request: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to list buckets: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"{e}")


@router.get("/list-objects", response_model=ObjectListResponse)
async def list_objects(request: OSSBaseModel = Depends(), _current_user: UserResponse = Depends(get_current_user)):
    """
    List objects under the bucket
    """
    try:
        service = StorageService()
        return await service.list_objects(request)
    except ValueError as e:
        logger.error(f"Invalid list objects request: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to list objects: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"{e}")


@router.get("/get-object-info", response_model=ObjectInfo)
async def get_object_info(request: ObjectRequest = Depends(), _current_user: UserResponse = Depends(get_current_user)):
    """
    Get object metadata from the bucket
    """
    try:
        service = StorageService()
        return await service.get_object_info(request)
    except ValueError as e:
        logger.error(f"Invalid get object metadata request: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get object metadata: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"{e}")


@router.post("/rename-object", response_model=RenameResponse)
async def rename_object(request: RenameRequest, _current_user: UserResponse = Depends(get_current_user)):
    """
    Rename object inside the bucket
    """
    try:
        service = StorageService()
        return await service.rename_object(request)
    except ValueError as e:
        logger.error(f"Invalid rename object: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to rename object: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"{e}")


@router.delete("/delete-object", response_model=DeleteResponse)
async def delete_object(request: ObjectRequest, _current_user: UserResponse = Depends(get_current_user)):
    """
    Delete object inside the bucket
    """
    try:
        service = StorageService()
        return await service.delete_object(request)
    except ValueError as e:
        logger.error(f"Invalid delete object: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to delete object: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"{e}")


@router.post("/upload-url", response_model=FileUpDownResponse)
async def upload_file(request: FileUpDownRequest, _current_user: UserResponse = Depends(get_current_user)):
    """
    Get a presigned URL for uploading a file to StorageService.

    Steps:
    1. Client calls this endpoint with file details
    2. Server validates and calls OSS service
    3. Returns presigned URL and access_url from OSS service
    4. Client uploads file directly to ObjectStorage using the presigned URL
    5. File is accessible at the returned access_url
    """
    try:
        service = StorageService()
        return await service.create_upload_url(request)
    except ValueError as e:
        logger.error(f"Invalid upload request: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to generate upload URL: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"{e}")


@router.post("/download-url", response_model=FileUpDownResponse)
async def download_file(request: FileUpDownRequest, _current_user: UserResponse = Depends(get_current_user)):
    """
    Get a presigned URL for downloading a file to StorageService.
    """
    try:
        service = StorageService()
        return await service.create_download_url(request)
    except ValueError as e:
        logger.error(f"Invalid download request: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to generate download URL: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"{e}")


@router.post("/local-upload/{bucket_name}/{object_key}")
async def local_upload_file(bucket_name: str, object_key: str, file: UploadFile = File(...)):
    """
    Local fallback upload endpoint used when OSS is not configured.
    """
    try:
        bucket_dir = LOCAL_STORAGE_ROOT / bucket_name
        bucket_dir.mkdir(parents=True, exist_ok=True)
        target = bucket_dir / object_key
        with target.open("wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
        return {"ok": True}
    except Exception as e:
        logger.error(f"Failed local upload: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"{e}")
    finally:
        await file.close()


@router.put("/local-upload/{bucket_name}/{object_key}")
async def local_upload_file_put(bucket_name: str, object_key: str, request: Request):
    """
    Local fallback upload endpoint for clients that PUT file bytes directly.
    """
    try:
        bucket_dir = LOCAL_STORAGE_ROOT / bucket_name
        bucket_dir.mkdir(parents=True, exist_ok=True)
        target = bucket_dir / object_key
        body = await request.body()
        with target.open("wb") as f:
            f.write(body)
        return {"ok": True}
    except Exception as e:
        logger.error(f"Failed local PUT upload: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"{e}")


@router.get("/local-files/{bucket_name}/{object_key}")
async def local_download_file(bucket_name: str, object_key: str):
    """
    Local fallback download endpoint used when OSS is not configured.
    """
    try:
        file_path = (LOCAL_STORAGE_ROOT / bucket_name / object_key).resolve()
        if not file_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
        return FileResponse(path=file_path)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed local file fetch: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"{e}")


@router.post("/proxy-upload")
async def proxy_upload_to_internal_oss(
    target_url: str,
    file: UploadFile = File(...),
    _current_user: UserResponse = Depends(get_current_user),
):
    """
    Proxy browser upload to an internal signed OSS URL.
    """
    if not _is_internal_target_url(target_url):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid target_url")

    try:
        body = await file.read()
        content_type = file.content_type or "application/octet-stream"
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.put(target_url, content=body, headers={"Content-Type": content_type})
        resp.raise_for_status()
        return {"ok": True}
    except httpx.HTTPError as e:
        logger.error(f"Proxy upload failed: {e}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxy upload failed: {e}")
    finally:
        await file.close()


@router.put("/proxy-upload")
async def proxy_upload_to_internal_oss_put(
    target_url: str,
    request: Request,
    _current_user: UserResponse = Depends(get_current_user),
):
    """
    Proxy browser PUT upload bytes to an internal signed OSS URL.
    """
    if not _is_internal_target_url(target_url):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid target_url")

    try:
        body = await request.body()
        content_type = request.headers.get("content-type", "application/octet-stream")
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.put(target_url, content=body, headers={"Content-Type": content_type})
        resp.raise_for_status()
        return {"ok": True}
    except httpx.HTTPError as e:
        logger.error(f"Proxy PUT upload failed: {e}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxy upload failed: {e}")


@router.get("/proxy-download")
async def proxy_download_from_internal_oss(target_url: str):
    """
    Proxy browser download from an internal signed OSS URL.
    """
    if not _is_internal_target_url(target_url):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid target_url")

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.get(target_url)
        resp.raise_for_status()
        media_type = resp.headers.get("content-type") or "application/octet-stream"
        return Response(content=resp.content, media_type=media_type)
    except httpx.HTTPError as e:
        logger.error(f"Proxy download failed: {e}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxy download failed: {e}")
