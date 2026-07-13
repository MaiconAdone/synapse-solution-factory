from fastapi import APIRouter, Depends

from app.security import require_api_key
from app.repositories.enterprise_spec import load_enterprise_spec
from app.repositories.cost_optimization_policy import load_cost_optimization_policy
from app.repositories.runtime_manifest import load_runtime_manifest
from app.services.ai_framework_selector import AiFrameworkSelector
from app.services.cost_aware_router import CostAwareRouter
from app.services.enterprise_spec_service import EnterpriseSpecService

router = APIRouter(dependencies=[Depends(require_api_key)])
spec_service = EnterpriseSpecService()
framework_selector = AiFrameworkSelector()
cost_router = CostAwareRouter()


@router.get("")
def runtime_manifest() -> dict[str, object]:
    return load_runtime_manifest()


@router.get("/enterprise-spec")
def enterprise_spec() -> dict[str, object]:
    return load_enterprise_spec()


@router.get("/enterprise-spec/alignment")
def enterprise_spec_alignment() -> dict[str, object]:
    return spec_service.validate_runtime_alignment()


@router.get("/ai-frameworks")
def ai_framework_catalog() -> dict[str, object]:
    return framework_selector.catalog


@router.get("/ai-frameworks/select")
def ai_framework_select(q: str, universe: str = "hybrid") -> dict[str, object]:
    return framework_selector.select(q, universe)


@router.get("/cost-policy")
def cost_optimization_policy() -> dict[str, object]:
    return load_cost_optimization_policy()


@router.get("/cost-aware-route")
def cost_aware_route(q: str, universe: str = "hybrid") -> dict[str, object]:
    return cost_router.route(q, universe)
