from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from gateway_api.auth.dependencies import CurrentUser, get_current_user
from gateway_api.config import get_gateway_config
from gateway_api.services.key_service import create_key
from gateway_api.services.litellm_client import (
    LiteLLMClient,
    LiteLLMClientError,
    get_litellm_client,
)

router = APIRouter(tags=["keys"])


class CreateKeyRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    comment: str | None = None
    duration_days: int | None = Field(default=None, ge=1)
    models: list[str] | None = None
    max_budget: float | None = None


@router.post("/keys")
async def create_api_key(
    body: CreateKeyRequest,
    user: CurrentUser = Depends(get_current_user),
    client: LiteLLMClient = Depends(get_litellm_client),
):
    try:
        # Build model_name -> mode mapping from LiteLLM model info
        model_modes: dict[str, str] = {}
        try:
            info_data = await client.list_model_info()
            for entry in info_data:
                name = entry.get("model_name", "")
                if not name or name in model_modes:
                    continue
                mi = entry.get("model_info", {})
                model_modes[name] = mi.get("mode", "chat") if isinstance(mi, dict) else "chat"
        except Exception:
            pass  # fall back to empty mapping; all models treated as chat

        result = await create_key(
            client=client,
            user_id=user.user_id,
            email=user.email,
            name=body.name,
            comment=body.comment,
            duration_days=body.duration_days,
            models=body.models,
            budget=body.max_budget,
            model_modes=model_modes,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LiteLLMClientError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/keys")
async def list_keys(
    user: CurrentUser = Depends(get_current_user),
    client: LiteLLMClient = Depends(get_litellm_client),
):
    keys = await client.list_keys(user.user_id)
    return {"keys": keys}


@router.get("/keys/{key_id}")
async def get_key(
    key_id: str,
    user: CurrentUser = Depends(get_current_user),
    client: LiteLLMClient = Depends(get_litellm_client),
):
    try:
        info = await client.get_key_info(key_id)
    except LiteLLMClientError:
        raise HTTPException(status_code=404, detail="Key not found")

    key_info = info.get("info", info)
    if key_info.get("user_id") != user.user_id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Not your key")

    return key_info


@router.delete("/keys/{key_id}")
async def delete_key(
    key_id: str,
    user: CurrentUser = Depends(get_current_user),
    client: LiteLLMClient = Depends(get_litellm_client),
):
    # Verify ownership
    try:
        info = await client.get_key_info(key_id)
    except LiteLLMClientError:
        raise HTTPException(status_code=404, detail="Key not found")

    key_info = info.get("info", info)
    if key_info.get("user_id") != user.user_id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Not your key")

    await client.delete_key(key_id)
    return {"status": "deleted", "key_id": key_id}
