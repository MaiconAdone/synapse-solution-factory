from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core_config import get_settings
from app.routes import agents, auth, business, evals, health, hybrid_llm, learning, local_llm, memory, mlflow, models, projects, rag, runtime, swarm, tools, workflows
from app.services.governed_swarm_dependencies import close_governed_swarm_service
from app.services.llm_dependencies import close_llm_services


settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    close_governed_swarm_service()
    close_llm_services()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Decoupled backend for Codex + Ruflo enterprise AI operations.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/health", tags=["health"])
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(agents.router, prefix="/agents", tags=["agents"])
app.include_router(workflows.router, prefix="/workflows", tags=["workflows"])
app.include_router(models.router, prefix="/models", tags=["models"])
app.include_router(evals.router, prefix="/evals", tags=["evals"])
app.include_router(mlflow.router, prefix="/mlflow", tags=["mlflow"])
app.include_router(projects.router, prefix="/projects", tags=["projects"])
app.include_router(rag.router, prefix="/rag", tags=["rag"])
app.include_router(memory.router, prefix="/memory", tags=["memory"])
app.include_router(swarm.router, prefix="/swarm", tags=["swarm"])
app.include_router(runtime.router, prefix="/runtime", tags=["runtime"])
app.include_router(tools.router, prefix="/tools", tags=["tools"])
app.include_router(local_llm.router, prefix="/local-llm", tags=["local-llm"])
app.include_router(hybrid_llm.router, prefix="/llm", tags=["llm-routing"])
app.include_router(learning.router, prefix="/learning", tags=["continual-learning"])
app.include_router(business.router, prefix="/business", tags=["business-transformation"])
