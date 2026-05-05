from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from gateway_api.db.models import Base
from gateway_api.db.session import engine
from gateway_api.routers import admin, keys, models, users


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup
    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))  # verify connectivity
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(
    title="LLM Gateway API",
    version="1.0.0",
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
    lifespan=lifespan,
)

app.include_router(users.router, prefix="/api/v1")
app.include_router(models.router, prefix="/api/v1")
app.include_router(keys.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health():
    return {"status": "ok"}
