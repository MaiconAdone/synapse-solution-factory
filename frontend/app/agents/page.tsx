import { AppShell } from "@/components/AppShell";
import { getAgents } from "@/lib/api";

export default async function AgentsPage() {
  const agents = await getAgents();

  return (
    <AppShell>
      <header className="topbar">
        <h1>Agentes</h1>
        <span className="status">{agents.source}</span>
      </header>
      <section className="page-list">
        {agents.data.map((agent) => (
          <article className="list-row" key={agent.id}>
            <strong>{agent.id}</strong>
            <span>{agent.role}</span>
            {agent.domain ? <small>{agent.domain}</small> : null}
          </article>
        ))}
      </section>
    </AppShell>
  );
}
