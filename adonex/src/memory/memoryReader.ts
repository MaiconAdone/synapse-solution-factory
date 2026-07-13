import { promises as fs } from "node:fs";
import path from "node:path";
import { scanAndRedactSecrets } from "../security/secretScanner";
import {
  CORE_MEMORY_PATHS,
  MEMORY_PATHS
} from "./memoryFiles";
import type { MemoryBundle } from "./types";

export class MemoryReader {
  public constructor(
    private readonly root: string,
    private readonly maxFileChars = 20_000
  ) {}

  public async readAllMemory(): Promise<MemoryBundle> {
    return {
      agents: await this.read(MEMORY_PATHS.agents),
      projectMemory: await this.read(MEMORY_PATHS.projectMemory),
      currentState: await this.readCurrentState(),
      techStack: await this.readTechStack(),
      codingStandards: await this.readCodingStandards(),
      openIssues: await this.readOpenIssues(),
      sharedDialogMemory: await this.readSharedDialogMemory(),
      chatTasks: await this.readChatTasks(),
      decisionsIndex: await this.read(MEMORY_PATHS.decisionsIndex),
      agentContext: await this.readAgentContext()
    };
  }

  public async readCoreMemory(): Promise<string> {
    return this.join(CORE_MEMORY_PATHS);
  }

  public async readCurrentState(): Promise<string> {
    return this.read(MEMORY_PATHS.currentState);
  }

  public async readAgentContext(): Promise<string> {
    return this.read(MEMORY_PATHS.agentContext);
  }

  public async readForCodexHandoff(): Promise<string> {
    return this.join([
      MEMORY_PATHS.agents,
      MEMORY_PATHS.agentContext,
      MEMORY_PATHS.currentState,
      MEMORY_PATHS.openIssues,
      MEMORY_PATHS.sharedDialogMemory,
      MEMORY_PATHS.chatTasks
    ]);
  }

  public async readForAdoneXPrompt(): Promise<string> {
    return this.join([
      ...CORE_MEMORY_PATHS,
      MEMORY_PATHS.openIssues,
      MEMORY_PATHS.sharedDialogMemory,
      MEMORY_PATHS.chatTasks
    ]);
  }

  public async readOpenIssues(): Promise<string> {
    return this.read(MEMORY_PATHS.openIssues);
  }

  public async readCodingStandards(): Promise<string> {
    return this.read(MEMORY_PATHS.codingStandards);
  }

  public async readTechStack(): Promise<string> {
    return this.read(MEMORY_PATHS.techStack);
  }

  public async readSharedDialogMemory(): Promise<string> {
    return this.read(MEMORY_PATHS.sharedDialogMemory);
  }

  public async readChatTasks(): Promise<string> {
    return this.read(MEMORY_PATHS.chatTasks);
  }

  private async join(paths: readonly string[]): Promise<string> {
    const sections = await Promise.all(
      paths.map(async (relativePath) => {
        const content = await this.read(relativePath);
        return content ? `--- ${relativePath}\n${content}` : "";
      })
    );
    return sections.filter(Boolean).join("\n\n");
  }

  private async read(relativePath: string): Promise<string> {
    const target = path.join(this.root, relativePath);
    const content = await fs.readFile(target, "utf8").catch(() => "");
    return scanAndRedactSecrets(content.slice(0, this.maxFileChars)).redacted;
  }
}
