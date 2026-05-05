from fastapi import APIRouter, Depends, HTTPException

from gateway_api.auth.dependencies import CurrentUser, get_current_user, require_admin
from gateway_api.services.litellm_client import (
    LiteLLMClient,
    LiteLLMClientError,
    get_litellm_client,
)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
async def list_users(
    admin: CurrentUser = Depends(require_admin),
    client: LiteLLMClient = Depends(get_litellm_client),
):
    # LiteLLM doesn't have a direct "list all users" endpoint via the
    # standard API. We use the /user/list endpoint if available (v1.40+),
    # otherwise return a note.
    try:
        result = await client._request("GET", "/user/list")
        return {"users": result if isinstance(result, list) else []}
    except LiteLLMClientError:
        return {"users": [], "note": "User listing requires LiteLLM v1.40+"}


@router.get("/usage")
async def get_usage(
    admin: CurrentUser = Depends(require_admin),
    client: LiteLLMClient = Depends(get_litellm_client),
):
    try:
        result = await client._request("GET", "/global/spend")
        return result
    except LiteLLMClientError:
        return {"total_spend": 0, "note": "Spend tracking requires database mode"}


@router.delete("/users/{user_id}/keys/{key_id}")
async def admin_delete_key(
    user_id: str,
    key_id: str,
    admin: CurrentUser = Depends(require_admin),
    client: LiteLLMClient = Depends(get_litellm_client),
):
    try:
        await client.delete_key(key_id)
    except LiteLLMClientError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "deleted", "key_id": key_id, "user_id": user_id}
