import os
from functools import lru_cache

import yaml
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    litellm_api_url: str = "http://litellm:4000"
    litellm_master_key: str
    gateway_fqdn: str = "localhost"
    auth_provider: str = "github"
    database_url: str
    gateway_config_path: str = "/app/config/gateway.yaml"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def load_gateway_config() -> dict:
    path = get_settings().gateway_config_path
    if os.path.exists(path):
        with open(path) as f:
            return yaml.safe_load(f)
    return {
        "access_control": {"mode": "allow_all", "admin_emails": []},
        "tokens": {
            "max_keys_per_user": 10,
            "max_duration_days": 30,
            "default_max_budget": 10.0,
        },
    }


_gateway_config: dict | None = None


def get_gateway_config() -> dict:
    global _gateway_config
    if _gateway_config is None:
        _gateway_config = load_gateway_config()
    return _gateway_config
