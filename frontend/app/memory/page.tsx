import { AppShell } from "@/components/AppShell";
import { getMemory } from "@/lib/api";

export default async function MemoryPage() {
  const memory = await getMemory();

  return (
    <AppShell>
      <header className="topbar">
        <h1>Memória</h1>
        <span className="status">{memory.source}</span>
      </header>
      <section className="page-list">
        <article className="list-row">
          <strong>Backend {memory.data.backend}</strong>
          <span>Camadas {memory.data.tiers.join(", ")} com busca vetorial preparada.</span>
        </article>
        <article className="list-row">
          <strong>Embeddings</strong>
          <span>
            {memory.data.embeddings?.dimension ?? 384}-dim {memory.data.embeddings?.provider ?? "AgentDB"}
            {" "}com caminho preparado para recuperação semântica.
          </span>
        </article>
        <article className="list-row">
          <strong>Busca semântica</strong>
          <span>{memory.data.semantic_search?.index ?? "hnsw-ready"}</span>
        </article>
      </section>
    </AppShell>
  );
}
