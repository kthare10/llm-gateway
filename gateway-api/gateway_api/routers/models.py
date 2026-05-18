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
    models_data = await client.list_model_info()
    fqdn = get_settings().gateway_fqdn

    # Deduplicate by model name (LiteLLM may return multiple deployments)
    seen: dict[str, str] = {}
    for entry in models_data:
        model_name = entry.get("model_name", "")
        if not model_name or model_name in seen:
            continue
        model_info = entry.get("model_info", {})
        mode = model_info.get("mode", "chat") if isinstance(model_info, dict) else "chat"
        seen[model_name] = mode

    return {
        "api_host": f"https://{fqdn}",
        "models": [
            {"modelId": name, "mode": mode}
            for name, mode in seen.items()
        ],
    }
