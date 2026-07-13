import { AppShell } from "@/components/AppShell";
import { ProjectsConsole } from "@/components/ProjectsConsole";

export default function ProjectsPage() {
  return (
    <AppShell>
      <header className="topbar">
        <div>
          <p className="eyebrow">Projetos</p>
          <h1>Projetos e dados</h1>
        </div>
        <span className="status">storage gerenciado</span>
      </header>
      <ProjectsConsole />
    </AppShell>
  );
}
