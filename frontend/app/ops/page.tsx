import { AppShell } from "@/components/AppShell";
import { OpsConsole } from "@/components/OpsConsole";

export default function OpsPage() {
  return (
    <AppShell>
      <header className="topbar">
        <div>
          <p className="eyebrow">Controle do pipeline</p>
          <h1>Operações</h1>
        </div>
        <span className="status">console de ações</span>
      </header>
      <OpsConsole />
    </AppShell>
  );
}
