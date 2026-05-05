from fastapi import APIRouter, Depends

from gateway_api.auth.dependencies import CurrentUser, get_current_user
from gateway_api.config import get_settings
from gateway_api.services.litellm_client import LiteLLMClient, get_litellm_client

router = APIRouter(tags=["models"])


@router.get("/models")
async def list_models(
    user: CurrentUser = Depends(get_current_user),
    client: LiteLLMClient = Depends(get_litellm_client),
):
    models_data = await client.list_models()
    fqdn = get_settings().gateway_fqdn
    model_ids = [m.get("id", "") for m in models_data if m.get("id")]

    return {
        "api_host": f"https://{fqdn}",
        "models": [{"modelId": mid} for mid in model_ids],
    }
