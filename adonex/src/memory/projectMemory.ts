import { MemoryInitializer } from "./memoryInitializer";
import { MemoryReader } from "./memoryReader";
import { MemorySync } from "./memorySync";
import { MemoryWriter } from "./memoryWriter";

export class ProjectMemory {
  public readonly reader: MemoryReader;
  public readonly writer: MemoryWriter;
  public readonly sync: MemorySync;

  public constructor(
    public readonly root: string,
    maxDiffChars = 60_000,
    maxFileChars = 20_000
  ) {
    this.reader = new MemoryReader(root, maxFileChars);
    this.writer = new MemoryWriter(root);
    this.sync = new MemorySync(root, maxDiffChars, maxFileChars);
  }

  public initialize(): ReturnType<MemoryInitializer["initialize"]> {
    return new MemoryInitializer(this.root).initialize();
  }
}
