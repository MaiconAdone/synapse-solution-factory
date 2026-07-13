from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from app.models import Project
from app.schemas.projects import ProjectCreateRequest


class ProjectRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create_managed_project(
        self,
        request: ProjectCreateRequest,
        *,
        storage_backend: str,
        storage_bucket: str,
        storage_prefix: str,
        data_storage_prefix: str,
        owner_id: str | None = None,
    ) -> Project:
        project = Project(
            owner_id=owner_id,
            name=request.name,
            project_type=request.project_type,
            storage_backend=storage_backend,
            storage_bucket=storage_bucket,
            storage_prefix=storage_prefix,
            data_storage_prefix=data_storage_prefix,
            project_goal=request.project_goal,
            business_problem=request.business_problem,
            solution_focus=request.solution_focus,
            metadata_json={
                "activate_ruflo": request.activate_ruflo,
                "require_business_problem": request.require_business_problem,
                "success_metric_or_acceptance_criteria": request.success_metric_or_acceptance_criteria,
                "available_data_or_knowledge_sources": request.available_data_or_knowledge_sources,
                "risk_level": request.risk_level,
                "created_by_synapse": True,
            },
        )
        self.session.add(project)
        try:
            self.session.flush()
            if owner_id:
                self.session.execute(
                    text(
                        """
                        insert into public.project_members (project_id, user_id, role)
                        values (:project_id, :user_id, 'owner')
                        on conflict (project_id, user_id)
                        do update set role = 'owner'
                        """
                    ),
                    {"project_id": project.id, "user_id": owner_id},
                )
            self.session.commit()
        except IntegrityError as error:
            self.session.rollback()
            raise ValueError(f"Project already exists: {request.name}") from error
        self.session.refresh(project)
        return project

    def list_projects(self, user_id: str | None = None, is_admin: bool = False) -> list[Project]:
        query = select(Project).order_by(Project.created_at.desc())
        if not is_admin:
            if not user_id:
                return []
            member_project_ids = select(text("project_id")).select_from(text("public.project_members")).where(
                text("user_id = :user_id")
            )
            query = query.where(or_(Project.owner_id == user_id, Project.id.in_(member_project_ids))).params(user_id=user_id)
        return list(self.session.scalars(query))

    def get_by_name(self, name: str, user_id: str | None = None, is_admin: bool = False) -> Project | None:
        query = select(Project).where(Project.name == name)
        if not is_admin:
            if not user_id:
                return None
            member_project_ids = select(text("project_id")).select_from(text("public.project_members")).where(
                text("user_id = :user_id")
            )
            query = query.where(or_(Project.owner_id == user_id, Project.id.in_(member_project_ids))).params(user_id=user_id)
        return self.session.scalar(query)
