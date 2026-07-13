import type { TaskLifecyclePhase, TaskLifecycleState, TaskLifecycleStep } from "../llm/types";

const phaseTitles: Record<TaskLifecyclePhase, string> = {
  plan: "Plan",
  context: "Context",
  act: "Act",
  observe: "Observe",
  patch: "Patch",
  test: "Test",
  repair: "Repair",
  finalize: "Finalize"
};

export function createTaskLifecycle(now = new Date().toISOString()): TaskLifecycleStep[] {
  return (Object.keys(phaseTitles) as TaskLifecyclePhase[]).map((phase, index) => ({
    phase,
    title: phaseTitles[phase],
    state: index === 0 ? "active" : "pending",
    updatedAt: now
  }));
}

export function updateTaskLifecycle(
  lifecycle: TaskLifecycleStep[] | undefined,
  phase: TaskLifecyclePhase,
  state: TaskLifecycleState,
  detail?: string,
  now = new Date().toISOString()
): TaskLifecycleStep[] {
  const current = lifecycle?.length ? lifecycle : createTaskLifecycle(now);
  return current.map((step) =>
    step.phase === phase
      ? { ...step, state, detail, updatedAt: now }
      : step
  );
}

export function activateTaskPhase(
  lifecycle: TaskLifecycleStep[] | undefined,
  phase: TaskLifecyclePhase,
  detail?: string,
  now = new Date().toISOString()
): TaskLifecycleStep[] {
  const current = lifecycle?.length ? lifecycle : createTaskLifecycle(now);
  return current.map((step) => {
    if (step.phase === phase) {
      return { ...step, state: "active", detail, updatedAt: now };
    }
    if (step.state === "active") {
      return { ...step, state: "completed", updatedAt: now };
    }
    return step;
  });
}

export function completeTaskLifecycle(
  lifecycle: TaskLifecycleStep[] | undefined,
  detail?: string,
  now = new Date().toISOString()
): TaskLifecycleStep[] {
  const current = lifecycle?.length ? lifecycle : createTaskLifecycle(now);
  return current.map((step) => ({
    ...step,
    state: step.phase === "finalize" || step.state !== "pending" ? "completed" : "skipped",
    detail: step.phase === "finalize" ? detail ?? step.detail : step.detail,
    updatedAt: now
  }));
}