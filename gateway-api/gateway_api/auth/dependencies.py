from dataclasses import dataclass

from fastapi import Header, HTTPException

from gateway_api.auth.access_control import check_access
from gateway_api.config import get_gateway_config, get_settings


@dataclass
class CurrentUser:
    user_id: str
    email: str | None
    is_admin: bool


async def get_current_user(
    x_vouch_user: str = Header(default=""),
) -> CurrentUser:
    identity = x_vouch_user.strip()
    if not identity:
        raise HTTPException(status_code=401, detail="Not authenticated")

    settings = get_settings()
    auth_provider = settings.auth_provider
    cfg = get_gateway_config()
    ac = cfg.get("access_control", {})

    # For CILogon, X-Vouch-User is the email address.
    # For GitHub, X-Vouch-User is the GitHub username.
    if auth_provider == "github":
        user_id = identity
        email = None
    else:
        user_id = identity
        email = identity

    allowed, reason = check_access(user_id, email, ac, auth_provider)
    if not allowed:
        raise HTTPException(status_code=403, detail=reason)

    # Check admin status via email list (CILogon) or username list (GitHub)
    admin_emails = [e.lower() for e in ac.get("admin_emails", [])]
    admin_users = [u.lower() for u in ac.get("admin_users", [])]

    is_admin = False
    if email and email.lower() in admin_emails:
        is_admin = True
    if user_id.lower() in admin_users:
        is_admin = True

    return CurrentUser(user_id=user_id, email=email, is_admin=is_admin)


async def require_admin(
    user: CurrentUser = None,
    x_vouch_user: str = Header(default=""),
) -> CurrentUser:
    if user is None:
        user = await get_current_user(x_vouch_user)
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
