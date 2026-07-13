import json
import base64
import binascii
import re
import zipfile
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.core_config import get_settings
from app.db import get_session_factory
from app.repositories.projects import ProjectRepository
from app.schemas.projects import (
    ProjectBriefingRequest,
    ProjectBriefingResponse,
    ProjectAttachmentRequest,
    ProjectCreateRequest,
    ProjectCreateResponse,
    ProjectDetail,
    ProjectSummary,
)
from app.security import AuthContext, require_api_key
from app.services.project_briefing_service import ProjectBriefingService
from app.services.project_factory_service import ProjectFactoryError, ProjectFactoryService

router = APIRouter()
service = ProjectFactoryService()
briefing_service = ProjectBriefingService()


def _project_destination(storage_backend: str, storage_bucket: str | None, storage_prefix: str) -> str:
    if storage_backend == "local":
        return storage_prefix
    if storage_bucket:
        return f"{storage_backend}://{storage_bucket}/{storage_prefix}"
    return f"{storage_backend}://{storage_prefix}"


def _project_to_summary(project) -> dict[str, object]:
    metadata = project.metadata_json or {}
    return {
        "name": project.name,
        "project_type": project.project_type,
        "status": project.status,
        "destination": _project_destination(project.storage_backend, project.storage_bucket, project.storage_prefix),
        "storage_backend": project.storage_backend,
        "storage_bucket": project.storage_bucket,
        "storage_prefix": project.storage_prefix,
        "data_storage_prefix": project.data_storage_prefix,
        "repository_url": project.repository_url,
        "created_by_synapse": bool(metadata.get("created_by_synapse", True)),
        "synapse_registered_at": project.created_at.isoformat() if project.created_at else None,
    }


def _project_to_detail(project) -> dict[str, object]:
    metadata = project.metadata_json or {}
    return {
        **_project_to_summary(project),
        "project_goal": project.project_goal,
        "business_problem": project.business_problem,
        "solution_focus": project.solution_focus,
        "success_metric_or_acceptance_criteria": metadata.get("success_metric_or_acceptance_criteria"),
        "available_data_or_knowledge_sources": metadata.get("available_data_or_knowledge_sources"),
        "risk_level": metadata.get("risk_level"),
    }


def _download_response(project_name: str, archive_bytes: bytes) -> StreamingResponse:
    return StreamingResponse(
        BytesIO(archive_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{project_name}.zip"'},
    )


@router.post("/{project_name}/attachments")
def upload_local_attachment(
    project_name: str,
    request: ProjectAttachmentRequest,
    _auth: AuthContext = Depends(require_api_key),
) -> dict[str, object]:
    settings = get_settings()
    if settings.project_creation_mode == "managed":
        raise HTTPException(status_code=409, detail="Managed projects upload directly to Supabase Storage")

    try:
        project = service.get_local_project(project_name)
    except ProjectFactoryError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", request.filename).strip("._")
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid attachment filename")
    try:
        content = base64.b64decode(request.content_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="Invalid base64 attachment") from error
    if len(content) > 10_000_000:
        raise HTTPException(status_code=413, detail="Attachment exceeds the 10 MB limit")

    uploads_dir = Path(str(project["destination"])) / "data" / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    destination = uploads_dir / safe_name
    destination.write_bytes(content)
    return {
        "name": safe_name,
        "path": destination.relative_to(Path(str(project["destination"]))).as_posix(),
        "size": len(content),
    }


@router.get("/{project_name}/attachments")
def list_local_attachments(
    project_name: str,
    _auth: AuthContext = Depends(require_api_key),
) -> list[dict[str, object]]:
    settings = get_settings()
    if settings.project_creation_mode == "managed":
        raise HTTPException(status_code=409, detail="Managed projects list files directly from Supabase Storage")
    try:
        project = service.get_local_project(project_name)
    except ProjectFactoryError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    project_root = Path(str(project["destination"]))
    uploads_dir = project_root / "data" / "uploads"
    if not uploads_dir.exists():
        return []
    return [
        {
            "name": path.name,
            "path": path.relative_to(project_root).as_posix(),
            "size": path.stat().st_size,
        }
        for path in sorted(uploads_dir.iterdir(), key=lambda item: item.name.lower())
        if path.is_file() and not path.is_symlink()
    ]


def _managed_project_archive(project) -> bytes:
    project_data = _project_to_detail(project)
    readme = "\n".join(
        [
            f"# {project.name}",
            "",
            "Projeto criado pelo Synapse AI Factory.",
            "",
            f"- Tipo: {project.project_type}",
            f"- Status: {project.status}",
            f"- Storage: {_project_destination(project.storage_backend, project.storage_bucket, project.storage_prefix)}",
            f"- Dados: {project.data_storage_prefix}",
            "",
            "Arquivos de dados enviados pelo site ficam no Supabase Storage em `data/`.",
            "Quando o versionamento GitHub estiver ativo, este pacote pode ser substituido pelo repositorio completo.",
            "",
        ]
    )

    archive = BytesIO()
    with zipfile.ZipFile(archive, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.writestr(f"{project.name}/README.md", readme)
        zip_file.writestr(f"{project.name}/project.json", json.dumps(project_data, indent=2, ensure_ascii=False))
        zip_file.writestr(
            f"{project.name}/config/ai_ml_enterprise_spec.json",
            json.dumps(service.enterprise_spec.spec(), indent=2, ensure_ascii=False),
        )
        zip_file.writestr(f"{project.name}/data/README.md", "Envie CSV, Excel, JSON, JSONL ou Parquet pelo painel /synapse.\n")
        zip_file.writestr(f"{project.name}/docs/briefings/llm_ruflo_project_brief.md", project.project_goal or "Briefing pendente.\n")
    archive.seek(0)
    return archive.getvalue()


@router.get("", response_model=list[ProjectSummary])
def list_projects(auth: AuthContext = Depends(require_api_key)) -> list[dict[str, object]]:
    settings = get_settings()
    if settings.project_creation_mode == "managed":
        try:
            session_factory = get_session_factory()
            with session_factory() as session:
                return [
                    _project_to_summary(project)
                    for project in ProjectRepository(session).list_projects(
                        user_id=auth.user_id,
                        is_admin=auth.is_admin,
                    )
                ]
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    return service.list_local_projects()


@router.get("/{project_name}", response_model=ProjectDetail)
def get_project(project_name: str, auth: AuthContext = Depends(require_api_key)) -> dict[str, object]:
    settings = get_settings()
    if settings.project_creation_mode == "managed":
        try:
            session_factory = get_session_factory()
            with session_factory() as session:
                project = ProjectRepository(session).get_by_name(
                    project_name,
                    user_id=auth.user_id,
                    is_admin=auth.is_admin,
                )
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return _project_to_detail(project)

    try:
        return service.get_local_project(project_name)
    except ProjectFactoryError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/{project_name}/download")
def download_project(project_name: str, auth: AuthContext = Depends(require_api_key)) -> StreamingResponse:
    settings = get_settings()
    if settings.project_creation_mode == "managed":
        try:
            session_factory = get_session_factory()
            with session_factory() as session:
                project = ProjectRepository(session).get_by_name(
                    project_name,
                    user_id=auth.user_id,
                    is_admin=auth.is_admin,
                )
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return _download_response(project.name, _managed_project_archive(project))

    try:
        return _download_response(project_name, service.create_local_project_archive(project_name))
    except ProjectFactoryError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/briefing", response_model=ProjectBriefingResponse)
def project_briefing(
    request: ProjectBriefingRequest,
    _auth: AuthContext = Depends(require_api_key),
) -> dict[str, object]:
    return briefing_service.answer(request)


@router.post("/create", response_model=ProjectCreateResponse)
def create_project(
    request: ProjectCreateRequest,
    auth: AuthContext = Depends(require_api_key),
) -> dict[str, object]:
    settings = get_settings()
    try:
        if settings.project_creation_mode == "managed":
            session_factory = get_session_factory()
            with session_factory() as session:
                result = service.create_project(request, db_session=session, owner_id=auth.user_id)
        else:
            result = service.create_project(request)
    except ProjectFactoryError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    if result["returncode"] != 0:
        raise HTTPException(status_code=500, detail=result)
    return result
