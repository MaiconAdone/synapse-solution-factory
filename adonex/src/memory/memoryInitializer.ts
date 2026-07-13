import { promises as fs } from "node:fs";
import path from "node:path";
import { MEMORY_DIRECTORIES, MEMORY_TEMPLATES } from "./memoryFiles";

export class MemoryInitializer {
  public constructor(private readonly root: string) {}

  public async initialize(): Promise<{ created: string[]; preserved: string[] }> {
    for (const directory of MEMORY_DIRECTORIES) {
      await fs.mkdir(path.join(this.root, directory), { recursive: true });
    }
    const created: string[] = [];
    const preserved: string[] = [];
    for (const [relativePath, template] of Object.entries(MEMORY_TEMPLATES)) {
      const target = path.join(this.root, relativePath);
      try {
        await fs.access(target);
        preserved.push(relativePath);
      } catch {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, template, { encoding: "utf8", flag: "wx" });
        created.push(relativePath);
      }
    }
    return { created, preserved };
  }
}
