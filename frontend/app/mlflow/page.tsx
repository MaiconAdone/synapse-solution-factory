import { AppShell } from "@/components/AppShell";
import { getMlflowRuns, getMlflowStatus } from "@/lib/api";

export default async function MlflowPage() {
  const [status, runs] = await Promise.all([getMlflowStatus(), getMlflowRuns()]);
  const recentRuns = runs.data.runs ?? [];

  return (
    <AppShell>
      <header className="topbar">
        <div>
          <p className="eyebrow">Ciclo de vida dos modelos</p>
          <h1>MLflow</h1>
        </div>
        <span className="status">{status.data.available ? "rastreamento online" : "rastreamento em contingência"}</span>
      </header>

      <section className="metric-grid">
        <article className="metric-card">
          <span>Experimento</span>
          <strong>{status.data.experiment_name}</strong>
        </article>
        <article className="metric-card">
          <span>Execuções</span>
          <strong>{recentRuns.length}</strong>
        </article>
        <article className="metric-card">
          <span>Registro</span>
          <strong>{status.data.available ? "pronto" : "offline"}</strong>
        </article>
        <article className="metric-card">
          <span>Fonte</span>
          <strong>{status.source}</strong>
        </article>
      </section>

      <section className="panel">
        <h2>Servidor de tracking</h2>
        <div className="timeline">
          <span>{status.data.tracking_uri}</span>
          <span>{status.data.registry_uri}</span>
          <span>{status.data.reason ?? "disponível"}</span>
        </div>
      </section>

      <section className="page-list">
        {recentRuns.length === 0 ? (
          <article className="list-row">
            <strong>Nenhuma execução ainda</strong>
            <span>Treine um modelo por /models/train para criar a primeira execução no MLflow.</span>
          </article>
        ) : (
          recentRuns.map((run) => (
            <article className="list-row" key={run.run_id}>
              <strong>{run.tags["mlflow.runName"] ?? run.run_id}</strong>
              <span>{run.status}</span>
              <small>
                {Object.entries(run.metrics)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(" | ") || "sem métricas"}
              </small>
            </article>
          ))
        )}
      </section>
    </AppShell>
  );
}
