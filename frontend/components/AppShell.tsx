import { Activity, BarChart3, Bot, Database, FolderKanban, GitBranch, SlidersHorizontal, Workflow } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { UserMenu } from "@/components/UserMenu";

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand" aria-label="Synapse AI">
          <img src="/synapse.png" alt="" className="brand-logo" />
          <span>Synapse AI</span>
        </div>
        <nav>
          <NavLink href="/" label="Painel" icon={Activity} />
          <NavLink href="/projects" label="Projetos" icon={FolderKanban} />
          <NavLink href="/agents" label="Agentes" icon={Bot} />
          <NavLink href="/workflows" label="Workflows" icon={Workflow} />
          <NavLink href="/ops" label="OperaÃ§Ãµes" icon={SlidersHorizontal} />
          <NavLink href="/mlflow" label="MLflow" icon={BarChart3} />
          <NavLink href="/memory" label="MemÃ³ria" icon={Database} />
          <NavLink href="/swarm" label="Swarm" icon={GitBranch} />
        </nav>
        <UserMenu />
      </aside>
      <section className="workspace">{children}</section>
    </main>
  );
}
