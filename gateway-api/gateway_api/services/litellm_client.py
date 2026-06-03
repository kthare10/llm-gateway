import httpx

from gateway_api.config import get_settings


class LiteLLMClientError(Exception):
    pass


def _strip_alias_prefix(key_alias: str | None) -> str | None:
    """Remove the ``{user_id}::`` namespace prefix from a key alias."""
    if key_alias and "::" in key_alias:
        return key_alias.split("::", 1)[1]
    return key_alias


class LiteLLMClient:
    """Async client for the LiteLLM Proxy admin API."""

    def __init__(self) -> None:
        settings = get_settings()
        self.base_url = settings.litellm_api_url.rstrip("/")
        self.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.litellm_master_key}",
        }

    async def _request(self, method: str, path: str, **kwargs) -> dict | list:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.request(
                method,
                f"{self.base_url}{path}",
                headers=self.headers,
                **kwargs,
            )
            if resp.status_code not in (200, 201):
                raise LiteLLMClientError(
                    f"LiteLLM API error: status={resp.status_code} body={resp.text}"
                )
            return resp.json()

    # ---- User Management ----

    async def create_user(
        self, user_id: str, user_email: str, max_budget: float | None = None
    ) -> dict:
        payload: dict = {
            "user_id": user_id,
            "user_email": user_email,
            "auto_create_key": False,
        }
        if max_budget is not None:
            payload["max_budget"] = max_budget
        return await self._request("POST", "/user/new", json=payload)

    async def get_user_info(self, user_id: str) -> dict:
        return await self._request("GET", "/user/info", params={"user_id": user_id})

    # ---- Key Management ----

    async def generate_key(
        self,
        user_id: str,
        user_email: str,
        key_alias: str | None = None,
        duration: str | None = None,
        max_budget: float | None = None,
        models: list[str] | None = None,
        metadata: dict | None = None,
    ) -> dict:
        payload: dict = {
            "user_id": user_id,
            "metadata": metadata or {"user_email": user_email},
        }
        if key_alias is not None:
            payload["key_alias"] = key_alias
        if duration is not None:
            payload["duration"] = duration
        if max_budget is not None:
            payload["max_budget"] = max_budget
        if models is not None:
            payload["models"] = models
        return await self._request("POST", "/key/generate", json=payload)

    async def list_keys(self, user_id: str) -> list:
        try:
            info = await self.get_user_info(user_id)
        except LiteLLMClientError:
            return []
        keys = info.get("keys", [])
        for key in keys:
            if isinstance(key, dict) and "key_alias" in key:
                key["key_alias"] = _strip_alias_prefix(key["key_alias"])
        return keys

    async def get_key_info(self, key_id: str) -> dict:
        return await self._request("GET", "/key/info", params={"key": key_id})

    async def delete_key(self, key_id: str) -> dict:
        return await self._request("POST", "/key/delete", json={"keys": [key_id]})

    # ---- Model Management ----

    async def list_models(self) -> list:
        result = await self._request("GET", "/models")
        return result.get("data", []) if isinstance(result, dict) else []

    async def list_model_info(self) -> list:
        """Return per-model metadata from LiteLLM /model/info (includes mode)."""
        result = await self._request("GET", "/model/info")
        return result.get("data", []) if isinstance(result, dict) else []


def get_litellm_client() -> LiteLLMClient:
    return LiteLLMClient()
