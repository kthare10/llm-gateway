def check_access(
    user_id: str,
    email: str | None,
    ac_config: dict,
    auth_provider: str,
) -> tuple[bool, str]:
    mode = ac_config.get("mode", "allow_all")

    if mode == "allow_all":
        return True, ""

    if mode == "domain":
        if auth_provider == "github":
            return False, (
                "Access control mode 'domain' requires CILogon (email-based). "
                "GitHub auth uses usernames. Use 'github_org', 'github_users', or 'allow_all' instead."
            )
        check_email = email or user_id
        allowed_domains = ac_config.get("allowed_domains", [])
        for domain in allowed_domains:
            suffix = domain if domain.startswith("@") else f"@{domain}"
            if check_email.lower().endswith(suffix.lower()):
                return True, ""
        return False, f"Your email domain is not authorized. Allowed: {', '.join(allowed_domains)}"

    if mode == "group":
        # Group-based access requires CILogon isMemberOf claims,
        # which would be passed via additional headers. For now, allow
        # and log -- full group checking needs the IdP token parsed.
        return True, ""

    if mode == "github_org":
        # Org membership is enforced by Vouch Proxy's team_whitelist.
        # If the user reached this point, Vouch already validated org membership.
        if auth_provider != "github":
            return False, (
                "Access control mode 'github_org' requires GitHub auth provider. "
                "Use 'domain' or 'group' for CILogon."
            )
        return True, ""

    if mode == "github_users":
        if auth_provider != "github":
            return False, (
                "Access control mode 'github_users' requires GitHub auth provider. "
                "Use 'domain' or 'group' for CILogon."
            )
        allowed_users = [u.lower() for u in ac_config.get("allowed_github_users", [])]
        if user_id.lower() in allowed_users:
            return True, ""
        return False, "Your GitHub username is not in the allowed users list."

    return False, f"Unknown access control mode: {mode}"
