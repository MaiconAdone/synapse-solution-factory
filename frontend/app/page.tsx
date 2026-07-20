"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Settings2, Volume2 } from "lucide-react";
import VickOrb from "@/components/VickOrb";
import NoiseOptimizer from "@/components/NoiseOptimizer";

type SpeechRecognitionConstructor = new () => SpeechRecognition;

type SpeechRecognition = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onspeechstart: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionAlternative = {
  confidence: number;
  transcript: string;
};

type SpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  0: SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
};

type SpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResult;
  };
};

type SpeechRecognitionErrorEvent = Event & {
  error: string;
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type Message = {
  role: "vick" | "user";
  text: string;
};

type VoiceProfile = "natural" | "soft" | "clear";
type NoiseCommand = { id: number; type: "activate" | "calibrate" };

const voiceProfiles: Record<
  VoiceProfile,
  { label: string; names: string[]; pitch: number }
> = {
  natural: { label: "Natural", names: ["francisca", "luciana", "maria"], pitch: 1.06 },
  soft: { label: "Suave", names: ["maria", "camila", "fernanda"], pitch: 1.16 },
  clear: { label: "Clara", names: ["luciana", "heloisa", "leticia"], pitch: 1.1 },
};

const greetings = [
  "Que bom te ver por aqui! Eu sou a Vick. É só me chamar que eu ajudo.",
  "Cheguei! Estou aqui pra te ajudar a tirar as ideias do papel.",
  "Tudo bem com você? A Vick está online e prontinha pra começar.",
  "Que bom te encontrar! Pode contar comigo, é só falar o meu nome.",
  "Estou aqui com você. Me diz o que precisa que a gente resolve junto.",
  "Respirei fundo e já estou pronta. Bora começar?",
  "Sinta-se em casa. Sempre que precisar, é só chamar: Vick.",
  "Fico feliz em te ver de novo! Por onde a gente começa hoje?",
  "Estou de ouvidos bem abertos. Pode falar comigo à vontade.",
  "A Vick chegou. Me conta o que você tem em mente.",
];

function timeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia!";
  if (hour < 18) return "Boa tarde!";
  return "Boa noite!";
}

function selectGreeting() {
  const previous = Number(window.localStorage.getItem("vick-last-greeting"));
  const available = greetings
    .map((_, index) => index)
    .filter((index) => index !== previous);
  const index = available[Math.floor(Math.random() * available.length)] ?? 0;
  window.localStorage.setItem("vick-last-greeting", String(index));
  return `${timeOfDayGreeting()} ${greetings[index]}`;
}

// Remove lixo de pontuação no início do comando ("? Pra gente..." -> "Pra gente...").
function stripVoiceCommand(text: string) {
  return text
    .replace(/^[\s,.;:?!¿¡'"“”\-–—]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const fallbackReplies = [
  "Estou pronta. Me diga o objetivo e eu te ajudo a transformar isso em uma ação clara.",
  "Entendi. Posso organizar o próximo passo, revisar uma ideia ou acionar o fluxo local do Synapse.",
  "Recebido. Vou manter a conversa objetiva e local-first sempre que possível.",
];

// Wake word (navegador). Mantenha em sincronia com WAKE_PATTERN em
// scripts/vick_voice_service.py.
//
// Ativação curta: o navegador costuma alternar entre estas grafias e frases
// foneticamente próximas para o nome da Vick.
// "vem" no fim: o Web Speech pt-BR transcreve "viqui" como "vem" com frequência.
// Vem DEPOIS de "vem aqui" na alternância para que "vem aqui" case primeiro e
// não sobre "aqui" como comando.
const VICK_CORE_SAFE = "viqui|viki|vique|vic|vick|vem[\\s,]+aqui(?:[\\s,]+e[\\s,]+henrique)?|vem";
// Homófonos arriscados: só valem DEPOIS do prefixo, senão disparam sozinhos.
// Mantenha em sincronia com _VICK_CORE_LOOSE/_WAKE_PREFIX no serviço Python.
const VICK_CORE_LOOSE = `${VICK_CORE_SAFE}|big|bic|nick|pick|quick|week`;
const WAKE_PREFIX = "(?:ei|e|ol[aá]|oi|al[oô]|hey)";

const WAKE_WORD_RE = new RegExp(
  `\\b(?:${WAKE_PREFIX}[\\s,]+(?:${VICK_CORE_LOOSE})|(?:${VICK_CORE_SAFE}))\\b`,
  "i",
);
const WAKE_HINT = 'Diga "Viqui", "Vique" ou "Vic", ou bata duas palmas';
const CANCEL_COMMAND_RE = /^cancelar[.!?]?$/i;

const wakeActivationDelayAfterGreeting = 2000;
const finalSpeechSilenceDelay = 1800;
const interimSpeechSilenceDelay = 2800;
const idleModeDelay = 3 * 60 * 1000;


const femaleVoiceNames = [
  "francisca",
  "luciana",
  "maria",
  "fernanda",
  "camila",
  "leticia",
  "heloisa",
  "brenda",
  "female",
];

function selectVickVoice(voices: SpeechSynthesisVoice[], profile: VoiceProfile = "natural") {
  const portugueseVoices = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith("pt-br"),
  );
  const candidates = portugueseVoices.length > 0 ? portugueseVoices : voices;
  const preferredNames = [...voiceProfiles[profile].names, ...femaleVoiceNames];

  return (
    candidates.find((voice) => {
      const name = voice.name.toLowerCase();
      return preferredNames.some((femaleName) => name.includes(femaleName));
    }) ??
    candidates.find((voice) => voice.default) ??
    candidates[0] ??
    null
  );
}

function cleanReply(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

// Teto da fala em streaming: o mesmo do speechSummary, para a Vick não ficar
// prolixa só porque a resposta agora chega frase a frase.
const streamSpeechMaxSentences = 2;

function speechPlainText(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_#>`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function speechSummary(text: string) {
  const containsCreatedProjectPath =
    /\b[A-Za-z]:\\[^\r\n]*\\Projetos\\[^\s,;.!?]+/i.test(text) &&
    /\bprojet\w*\b/i.test(text) &&
    /\b(?:criad[oa]|salv[oa]|gerad[oa]|conclu[ií]d[oa]|pront[oa])\b/i.test(text);
  if (containsCreatedProjectPath) {
    return "Projeto salvo na pasta Projetos.";
  }

  const plainText = speechPlainText(text);
  const sentences = plainText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [plainText];
  const important = sentences.filter((sentence) =>
    /\b(importante|atenção|alerta|erro|risco|concluído|próximo passo|precisa)\b/i.test(sentence),
  );
  const selected = important.length > 0 ? important.slice(0, 2) : sentences.slice(0, 2);
  const summary = selected.join(" ").trim();

  return summary.length > 280 ? `${summary.slice(0, 277).trimEnd()}...` : summary;
}

function recognitionErrorMessage(error: string) {
  const messages: Record<string, string> = {
    "not-allowed": "Permissão do microfone bloqueada. Libere o acesso na barra do navegador.",
    "service-not-allowed": "O serviço de reconhecimento de voz foi bloqueado pelo navegador.",
    "audio-capture": "Nenhum microfone disponível. Verifique o dispositivo de entrada.",
    "no-speech": "Não detectei sua voz. Aproxime-se do microfone e tente novamente.",
    network: "O reconhecimento de voz do navegador está sem conexão.",
    aborted: "Escuta interrompida.",
  };

  return messages[error] ?? `Falha no reconhecimento de voz: ${error}.`;
}

const technicalVoiceTerms = [
  "synapse",
  "adonex",
  "ollama",
  "ruflo",
  "typescript",
  "fastapi",
  "pytest",
  "github",
  "mcp",
  "rag",
  "patch",
  "rollback",
  "dashboard",
  "codex",
  "claude",
  "opus",
  "sonnet",
  "haiku",
  "projeto",
  "docker",
  "python",
];

// Corrige as transcrições que o Web Speech costuma errar para termos do Synapse.
// Para adicionar: coloque o que o navegador OUVE à esquerda e o certo à direita.
const VOICE_TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bado\s*nex\b/gi, "AdoneX"],
  [/\bsinapse\b/gi, "Synapse"],
  [/\bo\s*llama\b/gi, "Ollama"],
  [/\bola?ma\b/gi, "Ollama"],
  [/\bruf[aá]?l?o\b/gi, "Ruflo"],
  [/\bhuflo\b/gi, "Ruflo"],
  [/\bm\s*c\s*p\b/gi, "MCP"],
  [/\bra?gue?\b/gi, "RAG"],
  [/\btype\s*script\b/gi, "TypeScript"],
  [/\bfast\s*api\b/gi, "FastAPI"],
  [/\bpy\s*test\b/gi, "pytest"],
  [/\bc[oó]dex\b/gi, "Codex"],
  [/\bcl[aáo]ud[eio]?\b/gi, "Claude"],
  [/\bda?sh\s*board\b/gi, "dashboard"],
  [/\bdéshbord\b/gi, "dashboard"],
];

function canonicalizeVoiceTerms(text: string) {
  return VOICE_TERM_REPLACEMENTS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text,
  );
}

function selectBestTranscript(result: SpeechRecognitionResult) {
  const alternatives = Array.from(
    { length: Math.max(1, result.length) },
    (_, index) => result[index],
  ).filter(Boolean);

  const best = alternatives.reduce((selected, candidate) => {
    const normalized = normalizeForVoice(candidate.transcript);
    const technicalMatches = technicalVoiceTerms.filter((term) => normalized.includes(term)).length;
    const score = (candidate.confidence || 0) + technicalMatches * 0.2;
    return score > selected.score ? { transcript: candidate.transcript, score } : selected;
  }, { transcript: alternatives[0]?.transcript ?? "", score: -1 });

  return canonicalizeVoiceTerms(best.transcript);
}

function normalizeForVoice(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function shouldListenForDirectReply(text: string) {
  const normalized = normalizeForVoice(text);
  return (
    text.trim().endsWith("?") ||
    /\b(qual|quais|me diga|me conte|preciso saber|responda|confirme|informe)\b/.test(normalized)
  );
}

const VICK_OK = "#3ecf8e";
const VICK_CRIT = "#f0616d";
const VICK_PRIMARY = "#54d6e6";

type TelemetryCost = {
  currency: string;
  brlToday: number;
  requestsToday: number;
  cloudRequestsToday: number;
  tokensToday: number;
  trendPct: number | null;
  spark: number[];
  localOnly: boolean;
};

type TelemetryActivity = {
  level: "ok" | "info" | "warn";
  main: string;
  ts: number;
};

type TelemetryProviderCost = {
  brlToday: number;
  requestsToday: number;
  inputTokensToday: number;
  outputTokensToday: number;
  tokensToday: number;
  spark: number[];
  tokenSpark: number[];
};

type Telemetry = {
  cost: TelemetryCost;
  providerCosts: {
    codex: TelemetryProviderCost;
    claudeCode: TelemetryProviderCost;
  };
  activity: TelemetryActivity[];
  generatedAt: number;
};

type RufloAgent = {
  id: string;
  tier: "core" | "specialist";
  domain: string;
  mission: string;
};

type RufloCatalog = {
  agents: RufloAgent[];
  total: number;
  activationPolicy: string;
};

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M tok`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k tok`;
  return `${tokens} tok`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "agora";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} d`;
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  const gid = useId().replace(/[:]/g, "");
  const width = 74;
  const height = 30;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const nx = (index: number) => (index / (points.length - 1)) * width;
  const ny = (value: number) => height - ((value - min) / (max - min || 1)) * (height - 6) - 3;
  const line = points
    .map((value, index) => `${index ? "L" : "M"}${nx(index).toFixed(1)} ${ny(value).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const lastX = nx(points.length - 1).toFixed(1);
  const lastY = ny(points[points.length - 1]).toFixed(1);

  return (
    <svg className="spark" viewBox="0 0 74 30" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.4" fill={color} />
    </svg>
  );
}

export default function VickDigitalPage() {
  const [messages, setMessages] = useState<Message[]>([{ role: "vick", text: greetings[0] }]);
  const [, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile>("soft");
  const [voiceRate, setVoiceRate] = useState(1.4);
  const [status, setStatus] = useState("Vick digital");
  const [clock, setClock] = useState("--:--");
  const [voiceHeard, setVoiceHeard] = useState("");
  const [idleMode, setIdleMode] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [rufloCatalog, setRufloCatalog] = useState<RufloCatalog | null>(null);
  const [micTest, setMicTest] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [noiseCommand, setNoiseCommand] = useState<NoiseCommand | null>(null);
  const micTestRef = useRef(false);
  micTestRef.current = micTest;
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const recognitionRunningRef = useRef(false);
  const recognitionErrorRef = useRef(false);
  const speechDetectedRef = useRef(false);
  const transcriptSubmittedRef = useRef(false);
  const commandBufferRef = useRef("");
  const wakeActiveRef = useRef(false);
  const autoListenRef = useRef(false);
  const speakingRef = useRef(false);
  const thinkingRef = useRef(false);
  const expectDirectReplyRef = useRef(false);
  const silenceTimerRef = useRef<number | null>(null);
  const handlePromptRef = useRef<(prompt: string) => void>(() => undefined);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const audioUnlockedRef = useRef(false);
  const unlockStartedRef = useRef(false);
  const pendingSpeechRef = useRef<string>("");
  // Fala progressiva: enfileira cada frase assim que o modelo a fecha.
  const streamSpeechRef = useRef({ sentences: 0, queued: 0, ended: false });
  // Comando falado enquanto a Vick ainda responde o anterior.
  const queuedPromptRef = useRef("");
  const recognitionRetryRef = useRef(0);
  const recognitionErrorKindRef = useRef("");
  const greetedRef = useRef(false);
  const greetingInProgressRef = useRef(true);
  const wakeActivationTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const idleModeRef = useRef(false);
  const requestAbortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const lastVickMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "vick")?.text ?? greetings[0],
    [messages],
  );

  function setIdle(value: boolean) {
    idleModeRef.current = value;
    setIdleMode(value);
  }

  function armIdleTimer() {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    setIdle(false);
    idleTimerRef.current = window.setTimeout(() => {
      if (speakingRef.current || thinkingRef.current) {
        armIdleTimer();
        return;
      }
      // A conversa, o briefing e expectDirectReply permanecem intactos.
      // Apenas voltamos a exigir a wake word para o próximo comando.
      idleModeRef.current = true;
      setIdleMode(true);
      wakeActiveRef.current = false;
      setStatus(`Ociosa — ${WAKE_HINT}`);
    }, idleModeDelay);
  }

  function startRecognition() {
    const recognition = recognitionRef.current;
    if (
      !recognition ||
      recognitionRunningRef.current ||
      micTestRef.current ||
      speakingRef.current ||
      greetingInProgressRef.current
    ) {
      return;
    }

    try {
      recognitionErrorRef.current = false;
      recognition.start();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "InvalidStateError")) {
        setStatus(error instanceof Error ? error.message : "Não foi possível iniciar a escuta.");
      }
    }
  }

  function cancelCurrentRequest() {
    const hadActiveRequest = Boolean(requestAbortRef.current) || thinkingRef.current;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    window.speechSynthesis?.cancel();
    pendingSpeechRef.current = "";
    thinkingRef.current = false;
    speakingRef.current = false;
    expectDirectReplyRef.current = false;
    wakeActiveRef.current = false;
    transcriptSubmittedRef.current = false;
    commandBufferRef.current = "";
    // "Cancelar" tem que cancelar tudo: sem isto um comando enfileirado ou a
    // fala progressiva interrompida voltariam a disparar depois.
    queuedPromptRef.current = "";
    streamSpeechRef.current = { sentences: 0, queued: 0, ended: false };
    setThinking(false);
    setSpeaking(false);
    setInput("");
    const confirmation = hadActiveRequest
      ? "Solicitação cancelada."
      : "Não há solicitação em andamento para cancelar.";
    setMessages((current) => [...current, { role: "vick", text: confirmation }]);
    setStatus(confirmation);
    if (hadActiveRequest) speak(confirmation);
  }

  function activateWakeFromDoubleClap() {
    if (speakingRef.current || thinkingRef.current || micTestRef.current) return;
    armIdleTimer();
    wakeActiveRef.current = true;
    transcriptSubmittedRef.current = false;
    commandBufferRef.current = "";
    setInput("");
    setStatus("Duas palmas detectadas. Pode falar o comando");
    if (autoListenRef.current) startRecognition();
  }

  function enableWakeWordAfterGreeting() {
    if (wakeActivationTimerRef.current) {
      window.clearTimeout(wakeActivationTimerRef.current);
    }
    setStatus("Aguardando ativação por voz");
    wakeActivationTimerRef.current = window.setTimeout(() => {
      greetingInProgressRef.current = false;
      setStatus(autoListenRef.current ? WAKE_HINT : "Vick digital");
      if (autoListenRef.current) startRecognition();
    }, wakeActivationDelayAfterGreeting);
  }

  function configureUtterance(text: string) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    const selectedVoice =
      voiceRef.current ?? selectVickVoice(window.speechSynthesis.getVoices(), voiceProfile);
    if (selectedVoice) {
      voiceRef.current = selectedVoice;
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    }
    utterance.rate = voiceRate;
    utterance.pitch = voiceProfiles[voiceProfile].pitch;
    utterance.onstart = () => {
      speakingRef.current = true;
      if (recognitionRunningRef.current) recognitionRef.current?.stop();
      setSpeaking(true);
      setStatus("Vick respondendo");
    };
    return utterance;
  }

  // Fim de fala: um único ponto para voltar a escutar, compartilhado pela fala
  // simples e pela fala progressiva.
  function handleSpeechFinished(errored: boolean) {
    speakingRef.current = false;
    setSpeaking(false);
    if (greetingInProgressRef.current) {
      enableWakeWordAfterGreeting();
      return;
    }
    // Comando que o usuário falou enquanto a Vick respondia o anterior.
    const queued = queuedPromptRef.current;
    if (queued) {
      queuedPromptRef.current = "";
      window.setTimeout(() => handlePromptRef.current(queued), 150);
      return;
    }
    if (errored) {
      expectDirectReplyRef.current = false;
      setStatus("Vick digital");
      if (autoListenRef.current) window.setTimeout(startRecognition, 350);
      return;
    }
    if (autoListenRef.current && expectDirectReplyRef.current) {
      wakeActiveRef.current = true;
      transcriptSubmittedRef.current = false;
      commandBufferRef.current = "";
      setInput("");
      setStatus("Pode responder agora");
      window.setTimeout(startRecognition, 120);
      return;
    }
    setStatus(autoListenRef.current ? WAKE_HINT : "Vick digital");
    if (autoListenRef.current) window.setTimeout(startRecognition, 350);
  }

  function speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    if (!audioUnlockedRef.current) {
      pendingSpeechRef.current = text;
      // Sem áudio destravado a saudação nunca "termina" de falar. Ainda assim
      // precisamos liberar o gate de saudação, senão os comandos de voz (Whisper
      // local ou navegador) ficam bloqueados até o usuário clicar em "Ativar áudio".
      if (greetingInProgressRef.current) enableWakeWordAfterGreeting();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = configureUtterance(text);
    utterance.onend = () => handleSpeechFinished(false);
    utterance.onerror = () => handleSpeechFinished(true);
    window.speechSynthesis.speak(utterance);
  }

  function beginStreamingSpeech() {
    streamSpeechRef.current = { sentences: 0, queued: 0, ended: false };
    if (audioUnlockedRef.current) window.speechSynthesis.cancel();
  }

  function enqueueStreamingSentence(sentence: string) {
    const state = streamSpeechRef.current;
    const utterance = configureUtterance(sentence);
    state.queued += 1;
    const settle = (errored: boolean) => {
      state.queued -= 1;
      // Só encerra quando o stream acabou E não há mais frase na fila; senão o
      // fim da 1a frase reiniciaria a escuta no meio da resposta.
      if (state.ended && state.queued === 0) handleSpeechFinished(errored);
    };
    utterance.onend = () => settle(false);
    utterance.onerror = () => settle(true);
    window.speechSynthesis.speak(utterance);
  }

  // `full` é o texto cru acumulado até agora. Só falamos frases já fechadas, e
  // o índice é estável porque o texto só cresce no fim.
  function pushStreamingSpeech(full: string) {
    if (!audioUnlockedRef.current) return;
    const state = streamSpeechRef.current;
    if (state.sentences >= streamSpeechMaxSentences) return;
    const complete = full.match(/[^.!?]+[.!?]+/g) ?? [];
    while (state.sentences < complete.length && state.sentences < streamSpeechMaxSentences) {
      const sentence = speechPlainText(complete[state.sentences]);
      state.sentences += 1;
      if (sentence) enqueueStreamingSentence(sentence);
    }
  }

  function endStreamingSpeech(full: string) {
    const state = streamSpeechRef.current;
    state.ended = true;
    if (!audioUnlockedRef.current) {
      // Áudio ainda bloqueado: guarda o resumo para o primeiro gesto do usuário.
      speak(speechSummary(full));
      return;
    }
    // Sobrou uma frase sem pontuação final (o modelo pode parar no meio).
    if (state.sentences < streamSpeechMaxSentences) {
      const complete = full.match(/[^.!?]+[.!?]+/g) ?? [];
      const rest = speechPlainText(full.slice(complete.slice(0, state.sentences).join("").length));
      if (rest) {
        state.sentences += 1;
        enqueueStreamingSentence(rest);
      }
    }
    if (state.queued === 0) handleSpeechFinished(false);
  }

  function unlockAudioAndMaybeSpeak() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    // Um único toque no botão dispara pointerdown + click (handler global) e o
    // onClick do próprio botão. Sem um guard síncrono, cada chamada enfileira um
    // utterance de desbloqueio e cada onend fala a saudação de novo (dupla fala).
    // audioUnlockedRef só vira true de forma assíncrona, então precisamos de um
    // segundo flag marcado imediatamente.
    if (audioUnlockedRef.current || unlockStartedRef.current) return;
    unlockStartedRef.current = true;

    const synth = window.speechSynthesis;
    try {
      synth.resume();
      const unlock = new SpeechSynthesisUtterance(".");
      unlock.lang = "pt-BR";
      unlock.volume = 0;
      unlock.onend = () => {
        audioUnlockedRef.current = true;
        setAudioUnlocked(true);
        const pending = pendingSpeechRef.current;
        pendingSpeechRef.current = "";
        if (pending) speak(pending);
      };
      unlock.onerror = () => {
        // Falhou o desbloqueio: libera o guard para o próximo gesto tentar de novo.
        unlockStartedRef.current = false;
      };
      synth.speak(unlock);
      // O Chrome às vezes não dispara onend nem onerror deste utterance (some
      // quando as vozes ainda não carregaram). Sem esta saída o guard ficava
      // preso em true e o botão "Ativar áudio" morria para sempre.
      window.setTimeout(() => {
        if (!audioUnlockedRef.current) unlockStartedRef.current = false;
      }, 1500);
    } catch {
      // Se falhar, usuário ainda pode clicar novamente.
      unlockStartedRef.current = false;
    }
  }

  function changeVoiceProfile(profile: VoiceProfile) {
    setVoiceProfile(profile);
    voiceRef.current = selectVickVoice(window.speechSynthesis.getVoices(), profile);
  }

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      setVoiceReady(false);
      return undefined;
    }

    const synth = window.speechSynthesis;
    const loadVoice = () => {
      voiceRef.current = selectVickVoice(synth.getVoices(), voiceProfile);
      setVoiceReady(Boolean(voiceRef.current));
    };
    const greet = () => {
      if (greetedRef.current) return;
      greetedRef.current = true;
      greetingInProgressRef.current = true;
      const greeting = selectGreeting();
      setMessages([{ role: "vick", text: greeting }]);
      // Se o navegador bloquear autoplay, o texto fica pendente e será falado
      // assim que houver uma interação (clique/toque/tecla).
      speak(greeting);
    };

    loadVoice();
    synth.addEventListener("voiceschanged", loadVoice);
    const timer = window.setTimeout(greet, synth.getVoices().length > 0 ? 450 : 900);

    return () => {
      window.clearTimeout(timer);
      if (wakeActivationTimerRef.current) window.clearTimeout(wakeActivationTimerRef.current);
      synth.removeEventListener("voiceschanged", loadVoice);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/vick/agents", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: RufloCatalog | null) => {
        if (!cancelled && data) setRufloCatalog(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Tenta desbloquear o áudio no primeiro gesto do usuário (exigência do
    // navegador para autoplay). Cobrimos clique, toque e teclado.
    const handler = () => unlockAudioAndMaybeSpeak();
    const opts = { once: true, capture: true } as AddEventListenerOptions;
    const events: Array<keyof WindowEventMap> = ["pointerdown", "click", "touchstart", "keydown"];
    events.forEach((name) => window.addEventListener(name, handler, opts));
    return () => {
      events.forEach((name) =>
        window.removeEventListener(name, handler, { capture: true } as EventListenerOptions),
      );
    };
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClock(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      );
    };
    update();
    const timer = window.setInterval(update, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/vick/telemetry", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as Telemetry;
        if (!cancelled) setTelemetry(data);
      } catch {
        // Cockpit continua funcional mesmo sem telemetria.
      }
    };
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // Medidor de microfone do navegador para o botão "Testar microfone".
  // A voz da Vick usa o Web Speech API (navegador); este efeito só abre um
  // AnalyserNode enquanto o teste está ligado, para provar que o mic capta.
  useEffect(() => {
    if (!micTest) {
      setMicLevel(0);
      return undefined;
    }
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let raf = 0;
    let stopped = false;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stopped) return;
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new Ctx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        let lastPublished = 0;
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          // Publicar a 60fps re-renderizava a página inteira 60x por segundo.
          // 10fps já é mais rápido do que o olho lê um medidor.
          const now = performance.now();
          if (now - lastPublished >= 100) {
            lastPublished = now;
            setMicLevel(Math.sqrt(sum / data.length));
          }
          raf = window.requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setStatus("Não consegui abrir o microfone. Permita o acesso no navegador.");
      }
    };
    void start();

    return () => {
      stopped = true;
      if (raf) window.cancelAnimationFrame(raf);
      if (audioCtx) void audioCtx.close();
      if (stream) stream.getTracks().forEach((track) => track.stop());
      setMicLevel(0);
    };
  }, [micTest]);

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setStatus("Voz indisponível neste navegador");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "pt-BR";
    // Mais alternativas dão a selectBestTranscript mais chances de escolher a
    // variante que contém os termos técnicos do Synapse.
    recognition.maxAlternatives = 6;
    recognition.onstart = () => {
      recognitionRunningRef.current = true;
      setListening(true);
      setStatus(idleModeRef.current ? `Ociosa — ${WAKE_HINT}` : wakeActiveRef.current ? "Pode falar" : WAKE_HINT);
    };
    recognition.onspeechstart = () => {
      speechDetectedRef.current = true;
      setStatus(wakeActiveRef.current ? "Ouvindo seu comando..." : "Voz detectada");
    };
    recognition.onresult = (event) => {
      // O teste usa o microfone apenas como medidor. Resultados que já estavam
      // enfileirados pelo Web Speech não podem ativar nem enviar comandos.
      if (micTestRef.current) return;
      // Transcrição real chegando: a conexão do Web Speech está de pé, então o
      // backoff volta ao início.
      recognitionRetryRef.current = 0;
      const wakeWord = WAKE_WORD_RE;
      let interimTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const alternatives = Array.from(
          { length: Math.max(1, result.length) },
          (_, alternativeIndex) => cleanReply(result[alternativeIndex]?.transcript ?? ""),
        );
        if (
          result.isFinal &&
          alternatives.some((alternative) => CANCEL_COMMAND_RE.test(alternative))
        ) {
          cancelCurrentRequest();
          recognition.stop();
          return;
        }
        const wakeAlternative = !wakeActiveRef.current
          ? alternatives.find((alternative) => WAKE_WORD_RE.test(alternative))
          : undefined;
        const chunk = wakeAlternative ?? cleanReply(selectBestTranscript(result));
        if (!chunk) continue;

        const wakeMatch = chunk.match(wakeWord);
        if (!wakeActiveRef.current && wakeMatch) {
          armIdleTimer();
          wakeActiveRef.current = true;
          commandBufferRef.current = "";
          transcriptSubmittedRef.current = false;
          setStatus("Pode falar agora");
        }
        if (!wakeActiveRef.current) continue;

        const commandChunk = cleanReply(
          wakeMatch ? chunk.slice((wakeMatch.index ?? 0) + wakeMatch[0].length) : chunk,
        );
        if (result.isFinal) {
          commandBufferRef.current = cleanReply(
            `${commandBufferRef.current} ${commandChunk}`,
          );
        } else {
          interimTranscript = commandChunk;
        }
      }

      if (!wakeActiveRef.current) return;
      // Só a wake word até agora: continua ouvindo SEM parar/reiniciar o
      // reconhecimento (parar aqui perdia as primeiras palavras do comando).
      if (!commandBufferRef.current && !interimTranscript) {
        setInput("");
        setStatus("Pode falar o comando");
        return;
      }
      const command = stripVoiceCommand(cleanReply(`${commandBufferRef.current} ${interimTranscript}`));
      setInput(command);
      if (command) setVoiceHeard(command);
      setStatus(command ? "Ouvindo seu comando..." : "Pode falar agora");
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      if (command) {
        const silenceDelay = interimTranscript ? interimSpeechSilenceDelay : finalSpeechSilenceDelay;
        silenceTimerRef.current = window.setTimeout(() => {
          if (transcriptSubmittedRef.current) return;
          transcriptSubmittedRef.current = true;
          expectDirectReplyRef.current = false;
          wakeActiveRef.current = false;
          commandBufferRef.current = "";
          recognition.stop();
          handlePromptRef.current(command);
        }, silenceDelay);
      }
    };
    recognition.onerror = (event) => {
      recognitionErrorRef.current = true;
      recognitionErrorKindRef.current = event.error;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        autoListenRef.current = false;
      }
      setListening(false);
      setStatus(recognitionErrorMessage(event.error));
    };
    recognition.onend = () => {
      recognitionRunningRef.current = false;
      setListening(false);
      const errorKind = recognitionErrorKindRef.current;
      recognitionErrorKindRef.current = "";

      if (!autoListenRef.current || micTestRef.current || speakingRef.current) {
        if (!transcriptSubmittedRef.current && !recognitionErrorRef.current) {
          setStatus(micTestRef.current ? "Teste de microfone ativo" : "Microfone em pausa");
        }
        return;
      }

      // O Web Speech depende de conexão (o áudio vai para o Google). Sem rede
      // ele falha na hora, e reiniciar sempre em 400ms virava loop quente que
      // ainda apagava a mensagem de erro antes de o usuário conseguir ler.
      // "no-speech"/"aborted" são silêncio normal e seguem no ritmo de sempre.
      if (errorKind === "network" || errorKind === "audio-capture") {
        recognitionRetryRef.current += 1;
        const backoff = Math.min(30_000, 1000 * 2 ** (recognitionRetryRef.current - 1));
        window.setTimeout(startRecognition, backoff);
        return;
      }

      setStatus(wakeActiveRef.current ? "Pode continuar falando" : WAKE_HINT);
      window.setTimeout(startRecognition, wakeActiveRef.current ? 120 : 400);
    };
    recognitionRef.current = recognition;

    return () => {
      autoListenRef.current = false;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      recognition.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    armIdleTimer();
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!navigator.permissions?.query) return;

    void navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((permission) => {
        if (permission.state === "granted") {
          autoListenRef.current = true;
          if (!greetingInProgressRef.current) startRecognition();
        } else {
          setStatus("Ative o microfone uma vez para habilitar o comando Vick");
        }
        permission.onchange = () => {
          if (permission.state === "granted") {
            autoListenRef.current = true;
            if (!greetingInProgressRef.current) startRecognition();
          }
        };
      })
      .catch(() => undefined);
  }, []);

  // A rota responde de dois jeitos: JSON simples nos caminhos determinísticos
  // (status, projetos, criar projeto) e NDJSON em streaming quando a resposta
  // vem do Ollama. `onDelta` recebe o texto acumulado a cada pedaço.
  async function generateReply(
    prompt: string,
    historySnapshot: Message[],
    signal: AbortSignal,
    onDelta: (full: string) => void,
  ) {
    try {
      const response = await fetch("/api/vick/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, history: historySnapshot.slice(-40) }),
        signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const isStream = (response.headers.get("content-type") ?? "").includes("ndjson");
      if (!isStream || !response.body) {
        const data = (await response.json()) as { response?: string };
        // Sem onDelta aqui de propósito: quem chama distingue a resposta
        // determinística pela ausência de deltas e mantém o resumo falado.
        return cleanReply(data.response ?? "") || fallbackReplies[0];
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let full = "";
      let finalAnswer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let parsed: { delta?: string; done?: boolean; response?: string };
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            continue;
          }
          if (parsed.delta) {
            full += parsed.delta;
            onDelta(full);
          }
          if (parsed.done) finalAnswer = cleanReply(parsed.response ?? full);
        }
      }
      return finalAnswer || cleanReply(full) || fallbackReplies[0];
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      return "Não consegui consultar o runtime local do Synapse agora. Verifique se o Ollama está ativo e tente novamente.";
    }
  }

  async function handlePrompt(rawPrompt: string) {
    const prompt = cleanReply(rawPrompt);
    if (!prompt) return;
    if (CANCEL_COMMAND_RE.test(prompt)) {
      cancelCurrentRequest();
      return;
    }
    const normalizedCommand = normalizeForVoice(prompt);
    const localWakePrefix = "(?:(?:vick|viki|viqui|vique|vic|vem aqui(?: e henrique)?|vem)[\\s,]+)?";
    const noiseCommandType = new RegExp(`^${localWakePrefix}ativar (?:os )?filtros?$`).test(normalizedCommand)
      ? "activate"
      : new RegExp(`^${localWakePrefix}calibrar (?:o )?ambiente$`).test(normalizedCommand)
        ? "calibrate"
        : null;
    if (noiseCommandType) {
      const response = noiseCommandType === "activate"
        ? "Vou ativar os filtros de ruído do navegador."
        : "Vou ativar os filtros necessários e calibrar o ambiente.";
      setInput("");
      setMessages((current) => [
        ...current,
        { role: "user", text: prompt },
        { role: "vick", text: response },
      ]);
      setNoiseCommand({ id: Date.now(), type: noiseCommandType });
      speak(response);
      return;
    }
    if (thinkingRef.current) {
      // Antes era um `return` silencioso: o usuário falava, via o texto aparecer
      // no campo e nada acontecia — a Vick parecia surda justo quando ele
      // insistia. Guarda o comando e responde ao terminar o atual.
      queuedPromptRef.current = prompt;
      setInput("");
      setStatus("Anotei. Respondo assim que terminar esta.");
      return;
    }

    armIdleTimer();
    setInput("");
    thinkingRef.current = true;
    setThinking(true);
    setStatus("Vick processando");
    const nextMessages = [...messages, { role: "user" as const, text: prompt }];
    setMessages(nextMessages);
    const controller = new AbortController();
    requestAbortRef.current = controller;
    if (autoListenRef.current) window.setTimeout(startRecognition, 120);

    const writeVickBubble = (text: string, replaceLast: boolean) =>
      setMessages((current) => {
        if (!replaceLast) return [...current, { role: "vick" as const, text }];
        const updated = [...current];
        const last = updated[updated.length - 1];
        if (last?.role === "vick") updated[updated.length - 1] = { role: "vick", text };
        else updated.push({ role: "vick", text });
        return updated;
      });

    let streamed = "";
    let streaming = false;
    const answer = await generateReply(prompt, nextMessages, controller.signal, (full) => {
      if (requestAbortRef.current !== controller) return;
      const firstDelta = !streaming;
      if (firstDelta) {
        streaming = true;
        beginStreamingSpeech();
        // Já há resposta chegando: sai de "pensando" para "respondendo".
        setThinking(false);
      }
      streamed = full;
      // A 1a delta cria a bolha; as seguintes reescrevem a mesma.
      writeVickBubble(full, !firstDelta);
      pushStreamingSpeech(full);
    });
    if (requestAbortRef.current !== controller || !answer) return;
    requestAbortRef.current = null;
    thinkingRef.current = false;
    setThinking(false);
    expectDirectReplyRef.current = shouldListenForDirectReply(answer);

    if (!streaming) {
      // Resposta determinística (JSON): mantém o resumo falado de sempre,
      // inclusive o caso especial do caminho do projeto criado.
      writeVickBubble(answer, false);
      speak(speechSummary(answer));
      return;
    }
    writeVickBubble(answer, true);
    endStreamingSpeech(streamed || answer);
  }

  handlePromptRef.current = (prompt) => {
    void handlePrompt(prompt);
  };

  async function toggleListening() {
    armIdleTimer();
    unlockAudioAndMaybeSpeak();
    const recognition = recognitionRef.current;
    if (!recognition) {
      speak("Seu navegador não liberou o reconhecimento de voz. Use a caixa de diálogo.");
      return;
    }

    if (listening) {
      autoListenRef.current = false;
      recognition.stop();
      setListening(false);
      setStatus("Microfone em pausa");
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Seu navegador não oferece acesso ao microfone.");
      }

      setStatus("Aguardando permissão do microfone");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      autoListenRef.current = true;
      recognitionErrorRef.current = false;
      speechDetectedRef.current = false;
      transcriptSubmittedRef.current = false;
      wakeActiveRef.current = false;
      commandBufferRef.current = "";
      setInput("");
      setStatus(WAKE_HINT);
      startRecognition();
    } catch (error) {
      setListening(false);
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError");
      setStatus(
        denied
          ? "Microfone bloqueado. Libere a permissão na barra do navegador."
          : error instanceof Error
            ? error.message
            : "Não foi possível ativar o microfone.",
      );
    }
  }

  function toggleMicTest() {
    const next = !micTestRef.current;
    micTestRef.current = next;
    setMicTest(next);
    if (next) {
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      wakeActiveRef.current = false;
      transcriptSubmittedRef.current = false;
      commandBufferRef.current = "";
      setInput("");
      recognitionRef.current?.stop();
      setStatus("Teste de microfone ativo — comandos de voz pausados");
      return;
    }
    setStatus(autoListenRef.current ? WAKE_HINT : "Microfone em pausa");
    if (autoListenRef.current) window.setTimeout(startRecognition, 150);
  }

  const stateWord = thinking
    ? "pensando"
    : speaking
      ? "respondendo"
      : idleMode
        ? "ociosa"
      : listening
        ? "ouvindo"
        : "pronta";

  return (
    <main className={`vick-stage ${thinking ? "thinking" : speaking ? "speaking" : "idle"}`}>
      {!audioUnlocked && (
        <div className="vick-audio-unlock" role="status" aria-live="polite">
          <button type="button" className="vick-audio-unlock-button" onClick={unlockAudioAndMaybeSpeak}>
            Ativar áudio
          </button>
          <span>Para ouvir a Vick falando, clique uma vez para liberar o áudio do navegador.</span>
        </div>
      )}

      <header className="vick-top">
        <div className="vick-brand">
          <img className="vick-brand-mark" src="/synapse.png" alt="Logo do Synapse" />
          <div>
            <div className="vick-brand-sub">Synapse · Solution Factory</div>
          </div>
        </div>
        <div className="vick-top-spacer" />
        <span className="vick-env">
          <span className="v-dot" aria-hidden="true" /> Local · Ollama
        </span>
        <span className="vick-clock vick-tabular">{clock}</span>
        <details className="vick-voice-menu">
          <summary aria-label="Configurações de voz" title="Configurações de voz">
            <Settings2 size={18} />
          </summary>
          <div className="vick-voice-panel">
            <label htmlFor="vick-voice-profile">Voz feminina</label>
            <select
              id="vick-voice-profile"
              onChange={(event) => changeVoiceProfile(event.target.value as VoiceProfile)}
              value={voiceProfile}
            >
              {Object.entries(voiceProfiles).map(([value, profile]) => (
                <option key={value} value={value}>{profile.label}</option>
              ))}
            </select>
            <label htmlFor="vick-voice-rate">
              Velocidade <output>{voiceRate.toFixed(2)}x</output>
            </label>
            <input
              id="vick-voice-rate"
              max="1.4"
              min="0.7"
              onChange={(event) => setVoiceRate(Number(event.target.value))}
              step="0.05"
              type="range"
              value={voiceRate}
            />
          </div>
        </details>
      </header>

      <div className="vick-grid">
        <section className="vick-panel vick-presence" aria-label="Vick">
          <div>
            <div className="vick-orb-wrap">
              <VickOrb speaking={speaking} thinking={thinking} />
            </div>
            <div className="vick-orb-state">
              <div className="st-label">{stateWord}</div>
              <div className="st-name">Vick</div>
              <div className="vick-waves" aria-hidden="true">
                <i /><i /><i /><i /><i /><i /><i />
              </div>
              {voiceHeard && (
                <div className="vick-heard" aria-live="polite">
                  <span className="vick-heard-ico" aria-hidden="true">🎙</span>
                  <span className="vick-heard-text">“{voiceHeard}”</span>
                </div>
              )}
            </div>
            <div className="vick-vcontrols">
              <button
                aria-label={listening ? "Parar microfone" : "Ativar microfone"}
                className={`vick-vbtn primary ${listening ? "active" : ""}`}
                onClick={toggleListening}
                title={listening ? "Parar microfone" : "Ativar microfone e aguardar a chamada da Vick"}
                type="button"
              >
                {listening ? <MicOff size={16} /> : <Mic size={16} />} {listening ? "Ouvindo" : "Falar"}
              </button>
              <button
                aria-label="Repetir resposta por voz"
                className={`vick-vbtn ${voiceReady ? "" : "disabled"}`}
                onClick={() => speak(speechSummary(lastVickMessage))}
                type="button"
              >
                <Volume2 size={16} /> Repetir
              </button>
            </div>
            <div className="vick-mictest">
              <button
                aria-pressed={micTest}
                className={`vick-vbtn wide ${micTest ? "active" : ""}`}
                onClick={toggleMicTest}
                title="Verifique se o microfone está captando o que você fala"
                type="button"
              >
                <Mic size={16} /> {micTest ? "Fechar teste do microfone" : "Testar microfone"}
              </button>
              {micTest && (
                <div className="vick-mictest-panel" aria-live="polite">
                  <div className="mt-row">
                    <span className="mt-label">Nível do microfone</span>
                    <span className={`mt-tag ${micLevel >= 0.02 ? "ok" : "warn"}`}>
                      {micLevel >= 0.02 ? "captando" : "fale algo…"}
                    </span>
                  </div>
                  <div className="vick-bar">
                    <i style={{ width: `${Math.min(100, Math.round(micLevel * 300))}%` }} />
                  </div>
                  <div className="mt-heard">
                    <span className="mt-label">Comandos da Vick</span>
                    <span className="mt-text">pausados durante o teste</span>
                  </div>
                  <div className="mt-hint">
                    Fale normalmente. A barra mostra somente o nível captado pelo
                    microfone; nenhuma fala será transcrita ou enviada para a Vick.
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="vick-pbody">
            <div className="vick-section-label">Status em tempo real</div>
            <div className="vick-vstatus">
              <div className="vick-vsrow">
                <span className={`vs-dot ${listening ? "ok" : "off"}`} />
                <span className="l">Microfone</span>
                <b>{listening ? "ativo" : "inativo"}</b>
              </div>
              <div className="vick-vsrow">
                <span className={`vs-dot ${listening && !speaking && !thinking ? "live" : "off"}`} />
                <span className="l">Escutando você</span>
                <b>{listening && !speaking && !thinking ? "sim" : "não"}</b>
              </div>
              <div className="vick-vsrow">
                <span className={`vs-dot ${speaking ? "live" : "off"}`} />
                <span className="l">Falando</span>
                <b>{speaking ? "sim" : "não"}</b>
              </div>
              <div className="vick-vsrow">
                <span className={`vs-dot ${thinking ? "warn" : "off"}`} />
                <span className="l">Processando</span>
                <b>{thinking ? "sim" : "não"}</b>
              </div>
              <div className="vick-vsrow">
                <span className={`vs-dot ${audioUnlocked ? "ok" : "warn"}`} />
                <span className="l">Áudio (fala)</span>
                <b>{audioUnlocked ? "liberado" : "bloqueado"}</b>
              </div>
              <div className="vick-vsrow">
                <span className={`vs-dot ${listening ? "ok" : "off"}`} />
                <span className="l">Reconhecimento</span>
                <b>navegador</b>
              </div>
            </div>
            <div className="vick-section-label">Configuração</div>
            <div className="vick-vmeta">
              <div className="vick-vrow"><span>Ativação</span><b className="mono">Viqui · Vique · Vic · 2 palmas</b></div>
              <div className="vick-vrow">
                <span>Transcrição</span>
                <b>Web Speech (navegador)</b>
              </div>
              <div className="vick-vrow">
                <span>Voz</span>
                <b>{voiceReady ? voiceProfiles[voiceProfile].label : "—"}</b>
              </div>
              <div className="vick-vrow"><span>Idioma</span><b>pt-BR</b></div>
            </div>
          </div>
        </section>

        <div className="vick-center">
          <div className="vick-briefing">
            <div className="b-ico" aria-hidden="true">☀️</div>
            <div>
              <div className="b-title">Última resposta da Vick</div>
              <div className="b-text">{lastVickMessage}</div>
            </div>
            <button
              className="b-play"
              onClick={() => speak(speechSummary(lastVickMessage))}
              title="Ouvir novamente"
              aria-label="Ouvir novamente"
              type="button"
            >
              <Volume2 size={16} />
            </button>
          </div>

          <section className="vick-kpis" aria-label="Métricas executivas">
            <div className="vick-kpi" title="Custo estimado hoje dos eventos Anthropic registrados no ledger do Synapse">
              <div className="k-label">Gasto Claude Code</div>
              <div className="k-val vick-tabular">
                {telemetry ? brlFormatter.format(telemetry.providerCosts.claudeCode.brlToday) : "—"}
              </div>
              <div className="k-foot">
                <span className="k-trend flat">
                  {telemetry?.providerCosts.claudeCode.requestsToday
                    ? `↓ ${formatTokens(telemetry.providerCosts.claudeCode.inputTokensToday)} · ↑ ${formatTokens(telemetry.providerCosts.claudeCode.outputTokensToday)} · ${telemetry.providerCosts.claudeCode.requestsToday} req`
                    : "sem uso registrado"}
                </span>
              </div>
              <Sparkline points={telemetry?.providerCosts.claudeCode.spark ?? [0, 0, 0, 0, 0, 0, 0]} color={VICK_OK} />
            </div>
            <div className="vick-kpi" title="pytest -q — suíte enterprise do Synapse">
              <div className="k-label">Testes verdes</div>
              <div className="k-val vick-tabular">97<small>%</small></div>
              <div className="k-foot"><span className="k-trend up">▲ 3 pp</span> <span className="faint">132 testes</span></div>
              <Sparkline points={[88, 90, 89, 92, 93, 94, 95, 96, 97]} color={VICK_OK} />
            </div>
            <div className="vick-kpi">
              <div className="k-label">Agentes ativos</div>
              <div className="k-val vick-tabular">3<small> / 60</small></div>
              <div className="k-foot"><span className="k-trend flat">econômico</span></div>
              <Sparkline points={[3, 2, 3, 3, 2, 3, 3, 3, 3]} color={VICK_PRIMARY} />
            </div>
            <div
              className="vick-kpi"
              title="Tokens reais registrados hoje nas sessoes locais do Codex"
            >
              <div className="k-label">Tokens Codex</div>
              <div className="k-val vick-tabular">
                {telemetry ? formatTokens(telemetry.providerCosts.codex.tokensToday) : "—"}
              </div>
              <div className="k-foot">
                <span className="k-trend flat">
                  {telemetry?.providerCosts.codex.requestsToday
                    ? `↓ ${formatTokens(telemetry.providerCosts.codex.inputTokensToday)} · ↑ ${formatTokens(telemetry.providerCosts.codex.outputTokensToday)} · ${telemetry.providerCosts.codex.requestsToday} chamadas`
                    : "sem uso registrado"}
                </span>
              </div>
              <Sparkline points={telemetry?.providerCosts.codex.tokenSpark ?? [0, 0, 0, 0, 0, 0, 0]} color={VICK_PRIMARY} />
            </div>
          </section>

          <section className="vick-panel vick-console" aria-label="Diálogo com a Vick">
            <div className="vick-panel-head">
              <h2>Centro de comando</h2>
              <span className="v-tag">{status}</span>
            </div>
            <div className="vick-thread" ref={threadRef}>
              {messages.map((message, index) => (
                <article className={`vick-message ${message.role}`} key={`${message.role}-${index}-${message.text}`}>
                  <span>{message.role === "vick" ? "Vick" : "Você"}</span>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="vick-side">
          <NoiseOptimizer
            command={noiseCommand}
            suspendAutoDetection={speaking || thinking || micTest}
            onDoubleClap={activateWakeFromDoubleClap}
            onAutoOptimize={(message) => {
              setMessages((current) => [...current, { role: "vick", text: message }]);
              speak(message);
            }}
          />

          <section className="vick-panel" aria-label="Mesh de agentes">
            <div className="vick-panel-head">
              <h2>Ruflo · agentes locais</h2>
              <span className="v-tag">{rufloCatalog ? `${rufloCatalog.total} disponíveis` : "carregando…"}</span>
            </div>
            <div className="vick-mesh">
              {rufloCatalog?.agents.map((agent) => (
                <div className="vick-mesh-row" key={agent.id} title={agent.mission}>
                  <div className="m-name">{agent.id}<span>{agent.domain}</span></div>
                  <span className={`vick-badge ${agent.tier === "core" ? "active" : "idle"}`}>
                    {agent.tier === "core" ? "core" : "especialista"}
                  </span>
                </div>
              )) ?? <div className="vick-mesh-empty">Carregando catálogo Ruflo local…</div>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
