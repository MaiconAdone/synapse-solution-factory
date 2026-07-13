export type VickVoiceState =
  | "disabled"
  | "idle"
  | "asleep"
  | "listening"
  | "thinking"
  | "editing"
  | "validating"
  | "awaiting_confirmation"
  | "muted"
  | "cancelled"
  | "error";

export interface VickVoiceConfig {
  enabled: boolean;
  wakeWord: string;
  engine: "simulated" | "local_service" | "openwakeword" | "vosk" | "faster_whisper";
  listenSeconds: number;
}

export interface VickVoiceStatus {
  name: "Vick";
  state: VickVoiceState;
  enabled: boolean;
  muted: boolean;
  wakeWord: string;
  engine: VickVoiceConfig["engine"];
  text: string;
}

export interface VickTranscriptResult extends VickVoiceStatus {
  activated: boolean;
  command?: string;
}

const DEFAULT_CONFIG: VickVoiceConfig = {
  enabled: true,
  wakeWord: "Vick",
  engine: "simulated",
  listenSeconds: 8
};

export class VickVoiceSession {
  private config: VickVoiceConfig;
  private state: VickVoiceState = "disabled";
  private muted = false;

  public constructor(config: Partial<VickVoiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = this.config.enabled ? "asleep" : "disabled";
  }

  public configure(config: Partial<VickVoiceConfig>): VickVoiceStatus {
    this.config = { ...this.config, ...config };
    if (!this.config.enabled) {
      this.state = "disabled";
    } else if (this.state === "disabled") {
      this.state = this.muted ? "muted" : "asleep";
    }
    return this.status();
  }

  public start(): VickVoiceStatus {
    if (!this.config.enabled) {
      this.state = "disabled";
      return this.status("Vick voice is disabled.");
    }
    this.state = this.muted ? "muted" : "asleep";
    return this.status("Vick is armed and waiting for the wake word.");
  }

  public stop(): VickVoiceStatus {
    this.state = "disabled";
    return this.status("Vick voice stopped.");
  }

  public toggleMute(): VickVoiceStatus {
    this.muted = !this.muted;
    this.state = this.muted ? "muted" : this.config.enabled ? "asleep" : "disabled";
    return this.status(this.muted ? "Vick voice muted." : "Vick voice unmuted.");
  }

  public setState(state: VickVoiceState, text?: string): VickVoiceStatus {
    this.state = state;
    return this.status(text);
  }

  public handleTranscript(transcript: string): VickTranscriptResult {
    const text = transcript.trim();
    if (!this.config.enabled || this.state === "disabled") {
      return { ...this.status("Vick is disabled."), activated: false };
    }
    if (this.muted) {
      return { ...this.status("Vick is muted."), activated: false };
    }

    const command = extractWakeCommand(text, this.config.wakeWord);
    if (command === undefined) {
      this.state = "asleep";
      return { ...this.status("Wake word was not detected."), activated: false };
    }

    this.state = "listening";
    const canonicalCommand = canonicalizeTechnicalTerms(command);
    return {
      ...this.status(
        canonicalCommand
          ? `Vick heard: ${canonicalCommand}`
          : "Vick activated and is listening for a command."
      ),
      activated: true,
      command: canonicalCommand
    };
  }

  public status(text?: string): VickVoiceStatus {
    return {
      name: "Vick",
      state: this.state,
      enabled: this.config.enabled,
      muted: this.muted,
      wakeWord: this.config.wakeWord,
      engine: this.config.engine,
      text: text ?? readableState(this.state)
    };
  }
}

export function extractWakeCommand(
  transcript: string,
  wakeWord = "Vick"
): string | undefined {
  const normalizedTranscript = normalizeVoiceText(transcript);
  const normalizedWakeWord = normalizeVoiceText(wakeWord);
  if (!normalizedTranscript || !normalizedWakeWord) return undefined;

  const aliases = new Set([
    normalizedWakeWord,
    "vic",
    "vicky",
    "vick"
  ]);
  for (const alias of aliases) {
    if (normalizedTranscript === alias) return "";
    if (normalizedTranscript.startsWith(`${alias} `)) {
      return transcript.trim().slice(alias.length).replace(/^[\s,;:.-]+/, "").trim();
    }
  }
  return undefined;
}

export function normalizeVoiceText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeTechnicalTerms(text: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bado\s*nex\b/gi, "AdoneX"],
    [/\bsinapse\b/gi, "Synapse"],
    [/\bo\s*llama\b/gi, "Ollama"],
    [/\brufalo\b/gi, "Ruflo"],
    [/\bm\s*c\s*p\b/gi, "MCP"],
    [/\btype\s*script\b/gi, "TypeScript"],
    [/\bfast\s*api\b/gi, "FastAPI"],
    [/\bgit\s*hub\b/gi, "GitHub"],
    [/\bpy\s*test\b/gi, "pytest"]
  ];
  return replacements.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text.trim()
  );
}

function readableState(state: VickVoiceState): string {
  switch (state) {
    case "disabled":
      return "Vick voice is stopped.";
    case "idle":
      return "Vick is idle.";
    case "asleep":
      return "Vick is waiting.";
    case "listening":
      return "Vick is listening.";
    case "thinking":
      return "Vick is thinking.";
    case "editing":
      return "Vick is editing.";
    case "validating":
      return "Vick is validating.";
    case "awaiting_confirmation":
      return "Vick is waiting for confirmation.";
    case "muted":
      return "Vick is muted.";
    case "cancelled":
      return "Vick cancelled the current task.";
    case "error":
      return "Vick voice needs attention.";
  }
}
