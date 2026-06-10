from gateway_api.config import get_gateway_config, get_settings
from gateway_api.services.litellm_client import LiteLLMClient


def _generate_config_snippets(
    api_key: str,
    models: list[str],
    fqdn: str,
    model_modes: dict[str, str] | None = None,
) -> dict:
    api_host = f"https://{fqdn}"
    modes = model_modes or {}

    chat_models = [m for m in models if modes.get(m, "chat") not in ("image_generation",)]
    image_models = [m for m in models if modes.get(m, "chat") == "image_generation"]

    default_model = chat_models[0] if chat_models else (models[0] if models else "default")

    curl_snippet = (
        f'curl {api_host}/v1/chat/completions \\\n'
        f'  -H "Content-Type: application/json" \\\n'
        f'  -H "Authorization: Bearer {api_key}" \\\n'
        f'  -d \'{{"model": "{default_model}", '
        f'"messages": [{{"role": "user", "content": "Hello"}}]}}\''
    )

    openai_python = (
        f"from openai import OpenAI\n\n"
        f'client = OpenAI(\n'
        f'    base_url="{api_host}/v1",\n'
        f'    api_key="{api_key}",\n'
        f')\n\n'
        f'response = client.chat.completions.create(\n'
        f'    model="{default_model}",\n'
        f'    messages=[{{"role": "user", "content": "Hello"}}],\n'
        f')\n'
        f'print(response.choices[0].message.content)'
    )

    chatbox_config = {
        "id": f"llm-gateway-{api_key[:8]}",
        "name": "LLM Gateway",
        "type": "openai",
        "settings": {
            "apiHost": api_host,
            "apiKey": api_key,
            "models": [
                {
                    "modelId": m,
                    "capabilities": ["reasoning", "tool_use"],
                    "contextWindow": 131072,
                }
                for m in chat_models
            ],
        },
    }

    claude_code_config = {
        "env": {
            "ANTHROPIC_BASE_URL": f"{api_host}/v1/",
            "ANTHROPIC_AUTH_TOKEN": api_key,
            "API_TIMEOUT_MS": "3000000",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1,
            "ANTHROPIC_MODEL": default_model,
            "ANTHROPIC_SMALL_FAST_MODEL": default_model,
            "ANTHROPIC_DEFAULT_SONNET_MODEL": default_model,
            "ANTHROPIC_DEFAULT_OPUS_MODEL": default_model,
            "ANTHROPIC_DEFAULT_HAIKU_MODEL": default_model,
        }
    }

    codex_config = (
        f'model = "{default_model}"\n'
        f'model_provider = "llm-gateway"\n'
        f"\n"
        f"[model_providers.llm-gateway]\n"
        f'name = "LLM Gateway"\n'
        f'base_url = "{api_host}/v1"\n'
        f'wire_api = "responses"\n'
        f'experimental_bearer_token = "{api_key}"\n'
    )

    opencode_config = {
        "$schema": "https://opencode.ai/config.json",
        "provider": {
            "llm-gateway": {
                "npm": "@ai-sdk/openai-compatible",
                "name": "LLM Gateway",
                "options": {
                    "baseURL": f"{api_host}/v1",
                    "apiKey": api_key,
                },
                "models": {
                    m: {
                        "name": m,
                        "limit": {
                            "context": 200000,
                            "output": 65536,
                        },
                    }
                    for m in chat_models
                },
            }
        },
        "model": f"llm-gateway/{default_model}",
        "small_model": f"llm-gateway/{default_model}",
    }

    snippets: dict = {
        "curl": curl_snippet,
        "openai_python": openai_python,
        "chatbox": chatbox_config,
        "claude_code": claude_code_config,
        "codex": codex_config,
        "opencode": opencode_config,
    }

    if image_models:
        default_image_model = image_models[0]
        snippets["openai_python_image"] = (
            f"from openai import OpenAI\n\n"
            f'client = OpenAI(\n'
            f'    base_url="{api_host}/v1",\n'
            f'    api_key="{api_key}",\n'
            f')\n\n'
            f'result = client.images.generate(\n'
            f'    model="{default_image_model}",\n'
            f'    prompt="A cute baby sea otter",\n'
            f'    n=1,\n'
            f'    size="1024x1024",\n'
            f')\n'
            f'print(result.data[0].url)'
        )
        snippets["chatbox_image"] = {
            "id": f"llm-gateway-image-{api_key[:8]}",
            "name": "LLM Gateway (Image)",
            "type": "openai",
            "settings": {
                "apiHost": api_host,
                "apiKey": api_key,
                "models": [
                    {
                        "modelId": m,
                        "capabilities": ["image_generation"],
                        "contextWindow": 4096,
                    }
                    for m in image_models
                ],
            },
        }

    return snippets


async def create_key(
    client: LiteLLMClient,
    user_id: str,
    email: str | None,
    name: str,
    comment: str | None,
    duration_days: int | None,
    models: list[str] | None,
    budget: float | None,
    model_modes: dict[str, str] | None = None,
) -> dict:
    cfg = get_gateway_config()
    token_cfg = cfg.get("tokens", {})
    max_days = token_cfg.get("max_duration_days")
    max_keys = token_cfg.get("max_keys_per_user", 10)
    default_budget = token_cfg.get("default_max_budget")
    fqdn = get_settings().gateway_fqdn

    if duration_days is not None and max_days is not None:
        duration_days = min(duration_days, max_days)
    if budget is None:
        budget = default_budget

    user_email = email or f"{user_id}@github"

    # Ensure user exists in LiteLLM
    try:
        await client.get_user_info(user_id)
    except Exception:
        await client.create_user(user_id, user_email)

    # Check key count
    existing = await client.list_keys(user_id)
    if len(existing) >= max_keys:
        raise ValueError(
            f"Maximum of {max_keys} active keys allowed. "
            f"Delete an existing key first."
        )

    metadata = {"user_email": user_email}
    if comment:
        metadata["comment"] = comment

    result = await client.generate_key(
        user_id=user_id,
        user_email=user_email,
        key_alias=f"{user_id}::{name}",
        duration=f"{duration_days}d" if duration_days else None,
        max_budget=budget,
        models=models if models else None,
        metadata=metadata,
    )

    api_key = result.get("key", "")
    selected_models = models or []
    modes = model_modes or {}
    image_model_names = [m for m in selected_models if modes.get(m, "chat") == "image_generation"]

    return {
        "api_key": api_key,
        "key_id": result.get("token", ""),
        "key_alias": name,
        "expires_at": result.get("expires", ""),
        "max_budget": budget,
        "models": selected_models,
        "image_models": image_model_names,
        "config_snippets": _generate_config_snippets(api_key, selected_models, fqdn, model_modes),
    }
