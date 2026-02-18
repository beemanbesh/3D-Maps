"""
Async client for Meshy.ai v2 API — text-to-3D and image-to-3D generation.
"""

import asyncio
import logging

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class MeshyClient:
    """Async client for Meshy.ai v2 API."""

    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or settings.meshy_api_key
        self.base_url = (base_url or settings.meshy_api_base).rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.base_url,
            headers=self.headers,
            timeout=60.0,
        )

    async def text_to_3d_preview(
        self,
        prompt: str,
        art_style: str = "realistic",
        negative_prompt: str = "",
    ) -> str:
        """Start a text-to-3D preview task. Returns task_id."""
        async with self._client() as client:
            payload = {
                "mode": "preview",
                "prompt": prompt,
                "art_style": art_style,
            }
            if negative_prompt:
                payload["negative_prompt"] = negative_prompt

            resp = await client.post("/openapi/v2/text-to-3d", json=payload)
            resp.raise_for_status()
            data = resp.json()
            task_id = data.get("result") or data.get("task_id") or data.get("id")
            logger.info(f"Meshy text-to-3D preview started: {task_id}")
            return task_id

    async def text_to_3d_refine(self, preview_task_id: str) -> str:
        """Start a text-to-3D refine task from a completed preview. Returns task_id."""
        async with self._client() as client:
            payload = {
                "mode": "refine",
                "preview_task_id": preview_task_id,
            }
            resp = await client.post("/openapi/v2/text-to-3d", json=payload)
            resp.raise_for_status()
            data = resp.json()
            task_id = data.get("result") or data.get("task_id") or data.get("id")
            logger.info(f"Meshy text-to-3D refine started: {task_id}")
            return task_id

    async def image_to_3d(self, image_url: str) -> str:
        """Start an image-to-3D task. Returns task_id."""
        async with self._client() as client:
            payload = {"image_url": image_url}
            resp = await client.post("/openapi/v2/image-to-3d", json=payload)
            resp.raise_for_status()
            data = resp.json()
            task_id = data.get("result") or data.get("task_id") or data.get("id")
            logger.info(f"Meshy image-to-3D started: {task_id}")
            return task_id

    async def get_task(self, task_id: str) -> dict:
        """Get the status and result of a Meshy task."""
        async with self._client() as client:
            resp = await client.get(f"/openapi/v2/text-to-3d/{task_id}")
            resp.raise_for_status()
            return resp.json()

    async def get_image_task(self, task_id: str) -> dict:
        """Get the status and result of an image-to-3D task."""
        async with self._client() as client:
            resp = await client.get(f"/openapi/v2/image-to-3d/{task_id}")
            resp.raise_for_status()
            return resp.json()

    async def poll_until_done(
        self,
        task_id: str,
        timeout: int = 300,
        poll_interval: int = 10,
        task_type: str = "text",
    ) -> dict:
        """Poll a task until it reaches SUCCEEDED or FAILED status.

        Args:
            task_id: The Meshy task ID to poll.
            timeout: Maximum seconds to wait before timing out.
            poll_interval: Seconds between poll requests.
            task_type: 'text' or 'image' — determines which endpoint to poll.

        Returns:
            The final task result dict, including model_urls.glb when successful.

        Raises:
            TimeoutError: If the task doesn't complete within the timeout.
            RuntimeError: If the task fails.
        """
        get_fn = self.get_task if task_type == "text" else self.get_image_task
        elapsed = 0

        while elapsed < timeout:
            result = await get_fn(task_id)
            status = result.get("status", "").upper()

            if status == "SUCCEEDED":
                logger.info(f"Meshy task {task_id} succeeded")
                return result
            elif status in ("FAILED", "EXPIRED"):
                error_msg = result.get("message") or result.get("error") or "Unknown error"
                raise RuntimeError(f"Meshy task {task_id} failed: {error_msg}")

            logger.debug(f"Meshy task {task_id} status: {status} (progress: {result.get('progress', 0)}%)")
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        raise TimeoutError(f"Meshy task {task_id} timed out after {timeout}s")
