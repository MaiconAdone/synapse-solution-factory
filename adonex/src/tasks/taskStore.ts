import { promises as fs } from "node:fs";
import path from "node:path";
import type { TaskRecord } from "../llm/types";

export class TaskStore {
  private readonly taskRoot: string;

  public constructor(workspaceRoot: string) {
    this.taskRoot = path.join(workspaceRoot, ".adonex", "tasks");
  }

  public async save(record: TaskRecord): Promise<void> {
    await fs.mkdir(this.taskRoot, { recursive: true });
    record.updatedAt = new Date().toISOString();
    await fs.writeFile(
      this.pathFor(record.id),
      JSON.stringify(record, null, 2),
      "utf8"
    );
  }

  public async load(taskId: string): Promise<TaskRecord> {
    const raw = await fs.readFile(this.pathFor(taskId), "utf8");
    return JSON.parse(raw) as TaskRecord;
  }

  private pathFor(taskId: string): string {
    if (!/^[a-f0-9-]{8,}$/i.test(taskId)) {
      throw new Error("Invalid AdoneX task id.");
    }
    return path.join(this.taskRoot, `${taskId}.json`);
  }
}
