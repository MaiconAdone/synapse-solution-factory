from fastapi import APIRouter, Depends, HTTPException

from app.rag.pipeline import RagPipeline, RagPipelineError
from app.schemas.rag import RagIndexRequest, RagQueryRequest
from app.security import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])
pipeline = RagPipeline()


@router.get("/plan")
def rag_plan() -> dict[str, object]:
    return pipeline.plan()


@router.post("/indexes")
def build_index(request: RagIndexRequest) -> dict[str, object]:
    try:
        return pipeline.build_index(
            [document.model_dump() for document in request.documents],
            index_name=request.index_name,
            chunk_size=request.chunk_size,
            chunk_overlap=request.chunk_overlap,
        )
    except RagPipelineError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/query")
def query_index(request: RagQueryRequest) -> dict[str, object]:
    try:
        return pipeline.query(request.query, index_name=request.index_name, top_k=request.top_k)
    except RagPipelineError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
