"use client";

import { ChangeEvent, useEffect, useState } from "react";

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

type ProjectSummary = {
  name: string;
  project_type: string;
  status: string;
  destination: string;
  storage_backend: string;
  storage_bucket: string | null;
  storage_prefix: string;
  data_storage_prefix: string;
  repository_url: string | null;
};

type ProjectDetail = ProjectSummary & {
  project_goal: string | null;
  business_problem: string | null;
  solution_focus: string;
};

type UploadedFile = {
  name: string;
  path: string;
};

async function authHeaders() {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      headers.Authorization = `Bearer ${data.session.access_token}`;
    }
  }
  return headers;
}

async function getSynapse<T>(path: string): Promise<T> {
  const response = await fetch(`/api/synapse${path}`, {
    cache: "no-store",
    headers: await authHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail ?? data.error ?? `HTTP ${response.status}`);
  }
  return data as T;
}

async function downloadSynapse(path: string): Promise<Blob> {
  const response = await fetch(`/api/synapse${path}`, {
    cache: "no-store",
    headers: await authHeaders(),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.detail ?? data.error ?? `HTTP ${response.status}`);
  }
  return response.blob();
}

async function postSynapse<T>(path: string, body: unknown): Promise<T> {
  const headers = await authHeaders();
  headers["Content-Type"] = "application/json";
  const response = await fetch(`/api/synapse${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail ?? data.error ?? `HTTP ${response.status}`);
  }
  return data as T;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

export function ProjectsConsole() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      const result = await getSynapse<ProjectSummary[]>("/projects");
      setProjects(result);
      if (!selectedName && result.length > 0) {
        setSelectedName(result[0].name);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar projetos");
    } finally {
      setLoading(false);
    }
  }

  async function loadProject(name = selectedName) {
    if (!name) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getSynapse<ProjectDetail>(`/projects/${encodeURIComponent(name)}`);
      setSelectedProject(result);
      setSelectedName(result.name);
      await listUploadedFiles(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao abrir projeto");
    } finally {
      setLoading(false);
    }
  }

  async function listUploadedFiles(project: ProjectDetail) {
    if (project.storage_backend === "local") {
      setUploadedFiles(
        await getSynapse<UploadedFile[]>(`/projects/${encodeURIComponent(project.name)}/attachments`),
      );
      return;
    }
    if (!project.storage_bucket || !isSupabaseConfigured()) {
      setUploadedFiles([]);
      return;
    }

    const supabase = getSupabaseClient();
    const { data, error: listError } = await supabase.storage
      .from(project.storage_bucket)
      .list(project.data_storage_prefix, { limit: 100, sortBy: { column: "name", order: "asc" } });

    if (listError) {
      throw listError;
    }

    setUploadedFiles(
      (data ?? [])
        .filter((file) => file.name !== ".emptyFolderPlaceholder")
        .map((file) => ({
          name: file.name,
          path: `${project.data_storage_prefix}/${file.name}`,
        })),
    );
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!selectedProject || files.length === 0) {
      return;
    }
    setUploading(true);
    setError(null);
    try {
      if (selectedProject.storage_backend === "local") {
        for (const file of files) {
          await postSynapse(`/projects/${encodeURIComponent(selectedProject.name)}/attachments`, {
            filename: file.name,
            content_base64: await fileToBase64(file),
          });
        }
        await listUploadedFiles(selectedProject);
        event.target.value = "";
        return;
      }
      if (!selectedProject.storage_bucket || !isSupabaseConfigured()) {
        throw new Error("Supabase Storage nao esta configurado para este projeto.");
      }
      const supabase = getSupabaseClient();
      for (const file of files) {
        const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
        const path = `${selectedProject.data_storage_prefix}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from(selectedProject.storage_bucket).upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
        if (uploadError) {
          throw uploadError;
        }
      }
      await listUploadedFiles(selectedProject);
      event.target.value = "";
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Falha no upload");
    } finally {
      setUploading(false);
    }
  }

  async function downloadProject() {
    if (!selectedProject) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const blob = await downloadSynapse(`/projects/${encodeURIComponent(selectedProject.name)}/download`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${selectedProject.name}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Falha no download");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedName) {
      loadProject(selectedName);
    }
  }, [selectedName]);

  return (
    <div className="projects-grid">
      <section className="panel projects-panel">
        <div className="ops-result-header">
          <h2>Projetos criados</h2>
          <button className="ops-button secondary" type="button" onClick={loadProjects} disabled={loading}>
            Atualizar
          </button>
        </div>

        {error ? <p className="ops-error">{error}</p> : null}

        <div className="project-list">
          {projects.map((project) => (
            <button
              className={`project-row ${selectedName === project.name ? "active" : ""}`}
              key={project.name}
              type="button"
              onClick={() => setSelectedName(project.name)}
            >
              <strong>{project.name}</strong>
              <span>{project.storage_backend} / {project.status}</span>
            </button>
          ))}
          {projects.length === 0 && !loading ? <p className="muted">Nenhum projeto registrado ainda.</p> : null}
        </div>
      </section>

      <section className="panel projects-panel">
        <div className="ops-result-header">
          <h2>Projeto carregado</h2>
          <span className="status">{selectedProject?.storage_backend ?? "aguardando"}</span>
        </div>

        {selectedProject ? (
          <>
            <div className="project-detail">
              <strong>{selectedProject.name}</strong>
              <span>{selectedProject.project_type}</span>
              <small>Destino: {selectedProject.destination}</small>
              <small>Dados: {selectedProject.data_storage_prefix}</small>
            </div>

            <button className="ops-button secondary" type="button" onClick={downloadProject} disabled={loading}>
              Baixar projeto
            </button>

            <label className="ops-field">
              <span>Subir foto, documento ou dados</span>
              <input
                accept=".csv,.tsv,.xls,.xlsx,.json,.jsonl,.parquet,.pdf,.txt,.md,.png,.jpg,.jpeg,.webp"
                multiple
                type="file"
                onChange={uploadFiles}
                disabled={uploading}
              />
            </label>

            <div className="file-list">
              {uploadedFiles.map((file) => (
                <div className="file-row" key={file.path}>
                  <strong>{file.name}</strong>
                  <span>{file.path}</span>
                </div>
              ))}
              {uploadedFiles.length === 0 ? <p className="muted">Sem arquivos enviados por enquanto.</p> : null}
            </div>
          </>
        ) : (
          <p className="muted">Selecione um projeto para carregar os detalhes e a pasta de dados.</p>
        )}
      </section>
    </div>
  );
}
