from fastapi import APIRouter, Depends

from gateway_api.auth.dependencies import CurrentUser, get_current_user

router = APIRouter(tags=["users"])


@router.get("/me")
async def get_me(user: CurrentUser = Depends(get_current_user)):
    return {
        "user_id": user.user_id,
        "email": user.email,
        "is_admin": user.is_admin,
    }
