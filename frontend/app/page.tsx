"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Send, Settings2, Volume2 } from "lucide-react";
import VickNeuralCanvas from "@/components/VickNeuralCanvas";

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

const voiceProfiles: Record<
  VoiceProfile,
  { label: string; names: string[]; pitch: number }
> = {
  natural: { label: "Natural", names: ["francisca", "luciana", "maria"], pitch: 1.06 },
  soft: { label: "Suave", names: ["maria", "camila", "fernanda"], pitch: 1.16 },
  clear: { label: "Clara", names: ["luciana", "heloisa", "leticia"], pitch: 1.1 },
};

const greetings = [
  "Olá! Eu sou a Vick e o Synapse está pronto para começar.",
  "Bem-vindo ao Synapse. Vick online e pronta para ouvir você.",
  "Olá! A Vick chegou. Diga meu nome quando precisar de mim.",
  "Synapse iniciado com sucesso. Eu sou a Vick e estou à sua disposição.",
  "Bom te encontrar por aqui. A Vick está online e pronta para ajudar.",
  "Olá! Tudo conectado no Synapse. Pode me chamar de Vick.",
  "Vick online. Vamos transformar sua próxima ideia em ação.",
  "Bem-vindo de volta. O Synapse está ativo e a Vick está ouvindo.",
  "Olá! Sistemas locais prontos. Diga Vick para começar uma conversa.",
  "Synapse disponível. Eu sou a Vick, sua assistente digital.",
];

function selectGreeting() {
  const previous = Number(window.localStorage.getItem("vick-last-greeting"));
  const available = greetings
    .map((_, index) => index)
    .filter((index) => index !== previous);
  const index = available[Math.floor(Math.random() * available.length)] ?? 0;
  window.localStorage.setItem("vick-last-greeting", String(index));
  return greetings[index];
}

const fallbackReplies = [
  "Estou pronta. Me diga o objetivo e eu te ajudo a transformar isso em uma ação clara.",
  "Entendi. Posso organizar o próximo passo, revisar uma ideia ou acionar o fluxo local do Synapse.",
  "Recebido. Vou manter a conversa objetiva e local-first sempre que possível.",
];

const wakeActivationDelayAfterGreeting = 2000;
const finalSpeechSilenceDelay = 1800;
const interimSpeechSilenceDelay = 2800;


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

function speechSummary(text: string) {
  const plainText = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_#>`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  "patch",
  "rollback",
];

function canonicalizeVoiceTerms(text: string) {
  const replacements: Array<[RegExp, string]> = [
    [/\bado\s*nex\b/gi, "AdoneX"],
    [/\bsinapse\b/gi, "Synapse"],
    [/\bo\s*llama\b/gi, "Ollama"],
    [/\brufalo\b/gi, "Ruflo"],
    [/\bm\s*c\s*p\b/gi, "MCP"],
    [/\btype\s*script\b/gi, "TypeScript"],
    [/\bfast\s*api\b/gi, "FastAPI"],
    [/\bpy\s*test\b/gi, "pytest"],
  ];
  return replacements.reduce(
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

export default function VickDigitalPage() {
  const [messages, setMessages] = useState<Message[]>([{ role: "vick", text: greetings[0] }]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile>("natural");
  const [voiceRate, setVoiceRate] = useState(0.96);
  const [status, setStatus] = useState("Vick digital");
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
  const pendingSpeechRef = useRef<string>("");
  const greetedRef = useRef(false);
  const greetingInProgressRef = useRef(true);
  const wakeActivationTimerRef = useRef<number | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const localVoiceReadyRef = useRef(false);
  const localVoiceEventRef = useRef(0);

  const lastVickMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "vick")?.text ?? greetings[0],
    [messages],
  );

  function startRecognition() {
    const recognition = recognitionRef.current;
    if (
      !recognition ||
      recognitionRunningRef.current ||
      speakingRef.current ||
      thinkingRef.current ||
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

  function enableWakeWordAfterGreeting() {
    if (wakeActivationTimerRef.current) {
      window.clearTimeout(wakeActivationTimerRef.current);
    }
    setStatus("Aguardando ativação por voz");
    wakeActivationTimerRef.current = window.setTimeout(() => {
      greetingInProgressRef.current = false;
      setStatus(autoListenRef.current ? 'Diga "Vick"' : "Vick digital");
      if (autoListenRef.current) startRecognition();
    }, wakeActivationDelayAfterGreeting);
  }

  function speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    if (!audioUnlockedRef.current) {
      pendingSpeechRef.current = text;
      return;
    }

    window.speechSynthesis.cancel();
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
    utterance.onend = () => {
      speakingRef.current = false;
      setSpeaking(false);
      if (greetingInProgressRef.current) {
        enableWakeWordAfterGreeting();
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
      setStatus(autoListenRef.current ? 'Diga "Vick"' : "Vick digital");
      if (autoListenRef.current) window.setTimeout(startRecognition, 350);
    };
    utterance.onerror = () => {
      speakingRef.current = false;
      setSpeaking(false);
      if (greetingInProgressRef.current) {
        enableWakeWordAfterGreeting();
        return;
      }
      expectDirectReplyRef.current = false;
      setStatus("Vick digital");
      if (autoListenRef.current) window.setTimeout(startRecognition, 350);
    };
    window.speechSynthesis.speak(utterance);
  }

  function unlockAudioAndMaybeSpeak() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (audioUnlockedRef.current) return;

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
      synth.speak(unlock);
    } catch {
      // Se falhar, usuário ainda pode clicar novamente.
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
    // Tenta desbloquear o áudio no primeiro gesto do usuário.
    const handler = () => unlockAudioAndMaybeSpeak();
    window.addEventListener("pointerdown", handler, { once: true, capture: true });
    window.addEventListener("keydown", handler, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", handler, { capture: true } as unknown as EventListenerOptions);
      window.removeEventListener("keydown", handler, { capture: true } as unknown as EventListenerOptions);
    };
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const serviceUrl = "http://127.0.0.1:8765";

    const poll = async () => {
      try {
        const healthResponse = await fetch(`${serviceUrl}/health`, { cache: "no-store" });
        if (!healthResponse.ok) throw new Error(`HTTP ${healthResponse.status}`);
        const health = (await healthResponse.json()) as {
          engineReady?: boolean;
          error?: string | null;
        };
        if (cancelled) return;
        localVoiceReadyRef.current = Boolean(health.engineReady);
        if (health.engineReady) {
          autoListenRef.current = false;
          if (recognitionRunningRef.current) recognitionRef.current?.stop();
          setListening(true);
          if (!greetingInProgressRef.current) setStatus('Voz local ativa · diga "Vick"');
        } else if (health.error) {
          setStatus(`Voz local aguardando: ${health.error}`);
        }

        const eventResponse = await fetch(
          `${serviceUrl}/events?after=${localVoiceEventRef.current}`,
          { cache: "no-store" },
        );
        if (eventResponse.ok) {
          const payload = (await eventResponse.json()) as {
            events?: Array<{ id: number; command: string }>;
          };
          for (const event of payload.events ?? []) {
            localVoiceEventRef.current = Math.max(localVoiceEventRef.current, event.id);
            if (!greetingInProgressRef.current && event.command.trim()) {
              handlePromptRef.current(event.command);
            }
          }
        }
      } catch {
        localVoiceReadyRef.current = false;
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 800);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

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
    recognition.maxAlternatives = 3;
    recognition.onstart = () => {
      recognitionRunningRef.current = true;
      setListening(true);
      setStatus(wakeActiveRef.current ? "Pode falar" : 'Diga "Vick"');
    };
    recognition.onspeechstart = () => {
      speechDetectedRef.current = true;
      setStatus(wakeActiveRef.current ? "Ouvindo seu comando..." : "Voz detectada");
    };
    recognition.onresult = (event) => {
      const wakeWord = /\b(vick|vic|vik)\b/i;
      let interimTranscript = "";
      let restartForCommand = false;

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const chunk = cleanReply(selectBestTranscript(result));
        if (!chunk) continue;

        const wakeMatch = chunk.match(wakeWord);
        if (!wakeActiveRef.current && wakeMatch) {
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
          if (wakeMatch && !commandChunk) restartForCommand = true;
        } else {
          interimTranscript = commandChunk;
        }
      }

      if (!wakeActiveRef.current) return;
      if (restartForCommand && !commandBufferRef.current) {
        setInput("");
        setStatus("Ativada. Pode falar agora");
        recognition.stop();
        return;
      }
      const command = cleanReply(`${commandBufferRef.current} ${interimTranscript}`);
      setInput(command);
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
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        autoListenRef.current = false;
      }
      setListening(false);
      setStatus(recognitionErrorMessage(event.error));
    };
    recognition.onend = () => {
      recognitionRunningRef.current = false;
      setListening(false);
      if (
        autoListenRef.current &&
        !speakingRef.current &&
        !thinkingRef.current
      ) {
        setStatus(wakeActiveRef.current ? "Pode continuar falando" : 'Diga "Vick"');
        window.setTimeout(startRecognition, wakeActiveRef.current ? 120 : 400);
      } else if (!transcriptSubmittedRef.current && !recognitionErrorRef.current) {
        setStatus("Microfone em pausa");
      }
    };
    recognitionRef.current = recognition;

    return () => {
      autoListenRef.current = false;
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      recognition.stop();
      recognitionRef.current = null;
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

  async function generateReply(prompt: string, historySnapshot: Message[]) {
    try {
      const response = await fetch("/api/vick/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, history: historySnapshot.slice(-40) }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = (await response.json()) as { response?: string };
      const answer = cleanReply(data.response ?? "");
      if (answer) return answer;
    } catch {
      return "Não consegui consultar o runtime local do Synapse agora. Verifique se o Ollama está ativo e tente novamente.";
    }

    return fallbackReplies[0];
  }

  async function handlePrompt(rawPrompt: string) {
    const prompt = cleanReply(rawPrompt);
    if (!prompt || thinkingRef.current) return;

    setInput("");
    thinkingRef.current = true;
    setThinking(true);
    setStatus("Vick processando");
    const nextMessages = [...messages, { role: "user" as const, text: prompt }];
    setMessages(nextMessages);

    const answer = await generateReply(prompt, nextMessages);
    setMessages((current) => [...current, { role: "vick", text: answer }]);
    thinkingRef.current = false;
    setThinking(false);
    expectDirectReplyRef.current = shouldListenForDirectReply(answer);
    speak(speechSummary(answer));
  }

  handlePromptRef.current = (prompt) => {
    void handlePrompt(prompt);
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handlePrompt(input);
  }

  async function toggleListening() {
    unlockAudioAndMaybeSpeak();
    if (localVoiceReadyRef.current) {
      setStatus('Voz local ativa · diga "Vick"');
      speak("A transcrição local está ativa. Diga Vick e depois o comando.");
      return;
    }
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
      setStatus('Diga "Vick" para ativar o comando por voz');
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
      <details className="vick-voice-menu">
        <summary aria-label="Configurações de voz" title="Configurações de voz">
          <Settings2 size={20} />
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
      <section className="vick-orbit" aria-label="Vick digital">
        <div className="vick-halo" />
        <div className="vick-avatar" aria-hidden="true">
          <VickNeuralCanvas speaking={speaking} thinking={thinking} />
        </div>
        <div className="vick-signal">
          <span>{status}</span>
          <strong>Vick</strong>
        </div>
      </section>

      <section className="vick-console" aria-label="Diálogo com a Vick">
        <div className="vick-thread" ref={threadRef}>
          {messages.map((message, index) => (
            <article className={`vick-message ${message.role}`} key={`${message.role}-${index}-${message.text}`}>
              <span>{message.role === "vick" ? "Vick" : "Você"}</span>
              <p>{message.text}</p>
            </article>
          ))}
        </div>

        <form className="vick-dialog" onSubmit={handleSubmit}>
          <button
            aria-label={listening ? "Parar microfone" : "Ativar microfone"}
            className={`vick-control ${listening ? "active" : ""}`}
            onClick={toggleListening}
            title={listening ? "Parar microfone" : 'Ativar microfone e aguardar "Vick"'}
            type="button"
          >
            {listening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <input
            aria-label="Mensagem para a Vick"
            autoComplete="off"
            onChange={(event) => setInput(event.target.value)}
            placeholder="Fale ou digite para a Vick"
            value={input}
          />
          <button
            aria-label="Enviar mensagem digitada"
            className="vick-control primary"
            disabled={thinking}
            title="Enviar mensagem digitada"
            type="submit"
          >
            <Send size={20} />
          </button>
          <button
            aria-label="Repetir resposta por voz"
            className={`vick-control ${voiceReady ? "" : "disabled"}`}
            onClick={() => speak(speechSummary(lastVickMessage))}
            type="button"
          >
            <Volume2 size={20} />
          </button>
        </form>
      </section>
    </main>
  );
}
