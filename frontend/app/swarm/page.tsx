import { AppShell } from "@/components/AppShell";
import { getSwarm } from "@/lib/api";

export default async function SwarmPage() {
  const swarm = await getSwarm();

  return (
    <AppShell>
      <header className="topbar">
        <h1>Monitoramento do swarm</h1>
        <span className="status">{swarm.source}</span>
      </header>
      <section className="page-list">
        <article className="list-row">
          <strong>Topologia</strong>
          <span>
            {swarm.data.topology} com coordenacao {swarm.data.coordination} e alvo de consenso{" "}
            {swarm.data.consensus}.
          </span>
        </article>
        <article className="list-row">
          <strong>Core</strong>
          <span>{swarm.data.core} com status MCP e health checks expostos pelo backend.</span>
        </article>
        <article className="list-row">
          <strong>Runtime</strong>
          <span>
            {swarm.data.operational_state}, ate {swarm.data.max_agents} agentes,{" "}
            {swarm.data.core_agent_count ?? 15} core e{" "}
            {swarm.data.specialist_agent_count ?? 45} especialistas sob demanda, anti-drift{" "}
            {swarm.data.anti_drift ? "ativado" : "desativado"}.
          </span>
        </article>
      </section>
    </AppShell>
  );
}
