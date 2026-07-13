import { AppShell } from "@/components/AppShell";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";
import { getWorkflows } from "@/lib/api";

export default async function WorkflowsPage() {
  const workflows = await getWorkflows();

  return (
    <AppShell>
      <header className="topbar">
        <h1>Workflows</h1>
        <span className="status">{workflows.source}</span>
      </header>
      <WorkflowCanvas workflows={workflows.data} />
    </AppShell>
  );
}
