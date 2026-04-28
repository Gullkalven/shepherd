import logging
import ipaddress
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional, Union
from urllib.parse import quote_plus, urljoin, urlparse

import httpx
import mimetypes
from core.config import settings
from schemas.storage import (
    BucketInfo,
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

logger = logging.getLogger(__name__)


class StorageService:
    """Service for handling file upload and display with ObjectStorage service integration."""

    def __init__(self):
        # Use getattr for resilience when runtime settings object is missing newer attributes.
        self.oss_service_url = str(getattr(settings, "oss_service_url", "") or "").strip()
        self.oss_api_key = str(getattr(settings, "oss_api_key", "") or "").strip()
        self.oss_enabled = bool(self.oss_service_url and self.oss_api_key)

        self.headers = {}
        if self.oss_enabled:
            self.headers = {
                "Authorization": f"Bearer {self.oss_api_key}",
                "Content-Type": "application/json",
            }

    async def create_bucket(self, request: BucketRequest) -> BucketResponse:
        """
        Create a bucket name
        """
        endpoint = "api/v1/infra/client/oss/buckets"
        payload = {"bucket_name": request.bucket_name, "visibility": request.visibility}
        try:
            result = await self._apost_oss_service(endpoint, payload)
            return BucketResponse(bucket_name=result.get("bucket_name"), created_at=result.get("created_at"))
        except Exception as e:
            logger.error(f"Failed to create bucket: {e}")
            raise

    async def list_buckets(self) -> BucketListResponse:
        """
        List buckets of the user
        """
        endpoint = "api/v1/infra/client/oss/buckets"
        try:
            result = await self._aget_oss_service(endpoint=endpoint, params={})
            list_buckets = BucketListResponse()
            for item in result["buckets"]:
                list_buckets.buckets.append(BucketInfo(bucket_name=item["bucket_name"], visibility=item["visibility"]))
            return list_buckets
        except Exception as e:
            logger.error(f"Failed to list buckets: {e}")
            raise

    async def list_objects(self, request: OSSBaseModel) -> ObjectListResponse:
        """
        List objests from the bucket
        """
        endpoint = f"api/v1/infra/client/oss/buckets/{request.bucket_name}/objects"
        try:
            result = await self._aget_oss_service(endpoint=endpoint, params={})
            list_objs = ObjectListResponse()
            for item in result["objects"]:
                list_objs.objects.append(
                    ObjectInfo(
                        bucket_name=request.bucket_name,
                        object_key=item["key"],
                        size=item["size"],
                        last_modified=item["last_modified"],
                        etag=item["etag"],
                    )
                )
            return list_objs
        except Exception as e:
            logger.error(f"Failed to list bucket objects: {e}")
            raise

    async def get_object_info(self, request: ObjectRequest) -> ObjectInfo:
        """
        Get object metadata from the bucket
        """
        try:
            endpoint = f"api/v1/infra/client/oss/buckets/{request.bucket_name}/objects/metadata"
            params = {"object_key": request.object_key}
            result = await self._aget_oss_service(endpoint, params)
            return ObjectInfo(
                bucket_name=request.bucket_name,
                object_key=result["key"],
                size=result["size"],
                last_modified=result["last_modified"],
                etag=result["etag"],
            )
        except Exception as e:
            logger.error(f"Failed to get object metadata: {e}")
            raise

    async def rename_object(self, request: RenameRequest) -> dict:
        endpoint = f"api/v1/infra/client/oss/buckets/{request.bucket_name}/objects/rename"
        payload = {
            "overwrite_key": request.overwrite_key,
            "source_key": request.source_key,
            "target_key": request.target_key,
        }
        try:
            await self._apost_oss_service(endpoint, payload)
            return RenameResponse(success=True)
        except Exception as e:
            logger.error(f"Failed to rename object: {e}")
            raise

    async def delete_object(self, request: ObjectRequest) -> DeleteResponse:
        endpoint = f"api/v1/infra/client/oss/buckets/{request.bucket_name}/objects"
        payload = {"object_keys": [request.object_key]}
        try:
            await self._adelete_oss_service(endpoint, payload)
            return DeleteResponse(success=True)
        except Exception as e:
            logger.error(f"Failed to rename object: {e}")
            raise

    async def create_upload_url(self, request: FileUpDownRequest) -> FileUpDownResponse:
        """
        Create presigned URL for file upload with access URL.
        """
        if not self.oss_enabled:
            expires_at = self._fallback_expires_at()
            upload_url = (
                f"{settings.upload_base_url}/api/v1/storage/local-upload/"
                f"{request.bucket_name}/{request.object_key}"
            )
            return FileUpDownResponse(upload_url=upload_url, expires_at=expires_at)

        endpoint = f"/api/v1/infra/client/oss/buckets/{request.bucket_name}/objects/upload_url"
        payload = {"expires_in": 0, "object_key": request.object_key}
        try:
            result = await self._apost_oss_service(endpoint, payload)
            upload_url = result.get("upload_url", "")
            if self._is_internal_url(upload_url):
                upload_url = f"{settings.upload_base_url}/api/v1/storage/proxy-upload?target_url={quote_plus(upload_url)}"
            # Format response according to ObjectStorage service response
            return FileUpDownResponse(
                upload_url=upload_url,
                expires_at=result.get("expires_at"),
            )
        except Exception as e:
            logger.error(f"Failed to create upload URL: {e}")
            raise

    async def create_download_url(self, request: FileUpDownRequest) -> FileUpDownResponse:
        """
        Create presigned URL for file download with access URL.
        """
        if not self.oss_enabled:
            expires_at = self._fallback_expires_at()
            download_url = (
                f"{settings.upload_base_url}/api/v1/storage/local-files/"
                f"{request.bucket_name}/{request.object_key}"
            )
            return FileUpDownResponse(download_url=download_url, expires_at=expires_at)

        endpoint = f"/api/v1/infra/client/oss/buckets/{request.bucket_name}/objects/download_url"
        content_type, _ = mimetypes.guess_type(str(request.object_key))
        if not content_type:
            content_type = "application/octet-stream"
        payload = {
            "content_type": content_type,  # like "image/jpeg"
            "expires_in": 0,
            "object_key": request.object_key,
        }
        try:
            result = await self._apost_oss_service(endpoint, payload)
            download_url = result.get("download_url", "")
            if self._is_internal_url(download_url):
                download_url = (
                    f"{settings.upload_base_url}/api/v1/storage/proxy-download?target_url={quote_plus(download_url)}"
                )
            # Format response according to ObjectStorage service response
            return FileUpDownResponse(
                download_url=download_url,
                expires_at=result.get("expires_at"),
            )

        except Exception as e:
            logger.error(f"Failed to create upload URL: {e}")
            raise

    async def _aget_oss_service(self, endpoint: str, params: dict) -> dict:
        return await self._arequest_oss_service("GET", endpoint, params=params)

    async def _apost_oss_service(self, endpoint: str, payload: dict) -> Union[dict, list]:
        return await self._arequest_oss_service("POST", endpoint, payload=payload)

    async def _adelete_oss_service(self, endpoint: str, payload: dict) -> Union[dict, list]:
        return await self._arequest_oss_service("DELETE", endpoint, payload=payload)

    async def _arequest_oss_service(
        self,
        method: Literal["GET", "POST", "DELETE"],
        endpoint: str,
        params: Optional[dict] = None,
        payload: Optional[dict] = None,
    ) -> Union[dict, list]:
        """统一的 OSS 服务请求方法"""
        if not self.oss_enabled:
            raise ValueError("OSS service not configured. Set OSS_SERVICE_URL and OSS_API_KEY.")
        url = urljoin(self.oss_service_url, endpoint)

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.request(
                    method=method,
                    url=url,
                    headers=self.headers,
                    params=params,
                    json=payload,
                )
                response.raise_for_status()
                result = response.json()

                if result.get("code") != 0:
                    logger.warning(f"ObjectStorage service error: {result}")
                    error_msg = result.get("error", "Unknown error")
                    message = result.get("message", "")
                    raise ValueError(f"ObjectStorage service error: {error_msg}. {message}")

                return result.get("data", [])
        except httpx.HTTPStatusError as e:
            error_msg = f"ObjectStorage service HTTP error: {e.response.status_code} - {e.response.text}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        except Exception as e:
            logger.error(f"Failed to call ObjectStorage service: {e}")
            raise

    @staticmethod
    def _fallback_expires_at() -> str:
        return (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()

    @staticmethod
    def _is_internal_url(url: str) -> bool:
        if not url:
            return False
        try:
            parsed = urlparse(url)
            host = (parsed.hostname or "").strip().lower()
            if host in {"localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"}:
                return True
            ip = ipaddress.ip_address(host)
            return ip.is_private or ip.is_loopback or ip.is_link_local
        except ValueError:
            # Not an IP, treat common local service hostnames as internal.
            return host in {"minio", "storage", "oss"}
