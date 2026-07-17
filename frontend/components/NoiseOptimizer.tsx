"use client";

import { useEffect, useRef, useState } from "react";

type FilterKey = "noiseSuppression" | "echoCancellation" | "autoGainControl";
type FilterSettings = Record<FilterKey, boolean>;

type NoiseOptimizerProps = {
  command: { id: number; type: "activate" | "calibrate" } | null;
  onDoubleClap: () => void;
  onAutoOptimize: (message: string) => void;
  suspendAutoDetection: boolean;
};

const DEFAULTS: FilterSettings = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

const LABELS: Record<FilterKey, string> = {
  noiseSuppression: "Supressão de ruído",
  echoCancellation: "Cancelamento de eco",
  autoGainControl: "Ganho automático",
};

export default function NoiseOptimizer({ command, onDoubleClap, onAutoOptimize, suspendAutoDetection }: NoiseOptimizerProps) {
  const [settings, setSettings] = useState<FilterSettings>(DEFAULTS);
  const [supported, setSupported] = useState<Partial<Record<FilterKey, boolean>>>({});
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [noiseFloor, setNoiseFloor] = useState<number | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [message, setMessage] = useState("Ative para verificar e configurar seu microfone.");
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const levelRef = useRef(0);
  const activeRef = useRef(false);
  const supportedRef = useRef<Partial<Record<FilterKey, boolean>>>({});
  const noiseFloorRef = useRef<number | null>(null);
  const monitorStreamRef = useRef<MediaStream | null>(null);
  const monitorContextRef = useRef<AudioContext | null>(null);
  const monitorRafRef = useRef(0);
  const noisySinceRef = useRef(0);
  const autoOptimizationRef = useRef(false);
  const suspendAutoDetectionRef = useRef(suspendAutoDetection);
  const lastCommandRef = useRef(0);
  const lastClapRef = useRef(0);
  const clapArmedRef = useRef(true);
  const lastLevelPublishRef = useRef(0);
  suspendAutoDetectionRef.current = suspendAutoDetection;

  // Afunila o medidor em ~10fps: o olho não lê mais rápido que isso e o state a
  // cada frame custava um re-render por frame.
  function publishLevel(rms: number) {
    const now = performance.now();
    if (now - lastLevelPublishRef.current < 100) return;
    lastLevelPublishRef.current = now;
    setLevel(rms);
  }

  function detectDoubleClap(rms: number) {
    if (suspendAutoDetectionRef.current) {
      lastClapRef.current = 0;
      clapArmedRef.current = rms < 0.05;
      return;
    }
    const now = performance.now();
    const threshold = Math.max(0.11, (noiseFloorRef.current ?? 0) * 4);
    if (rms >= threshold && clapArmedRef.current) {
      const interval = now - lastClapRef.current;
      clapArmedRef.current = false;
      if (interval >= 150 && interval <= 900) {
        lastClapRef.current = 0;
        onDoubleClap();
      } else {
        lastClapRef.current = now;
      }
    } else if (rms < threshold * 0.45) {
      clapArmedRef.current = true;
    }
    if (lastClapRef.current && now - lastClapRef.current > 900) {
      lastClapRef.current = 0;
    }
  }

  useEffect(() => {
    const constraints = navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
    const nextSupported = {
      noiseSuppression: Boolean(constraints.noiseSuppression),
      echoCancellation: Boolean(constraints.echoCancellation),
      autoGainControl: Boolean(constraints.autoGainControl),
    };
    supportedRef.current = nextSupported;
    setSupported(nextSupported);
    try {
      const saved = window.localStorage.getItem("vick-noise-filters");
      if (saved) setSettings({ ...DEFAULTS, ...JSON.parse(saved) });
      const savedFloor = Number(window.localStorage.getItem("vick-noise-floor"));
      if (Number.isFinite(savedFloor) && savedFloor > 0) {
        noiseFloorRef.current = savedFloor;
        setNoiseFloor(savedFloor);
      }
    } catch {
      // Preferências inválidas não impedem o uso dos filtros nativos.
    }
    void startNoiseMonitor();
    return () => {
      stopStream();
      stopNoiseMonitor();
    };
  }, []);

  function stopStream() {
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close();
    audioContextRef.current = null;
    activeRef.current = false;
    setActive(false);
    setLevel(0);
  }

  function stopNoiseMonitor() {
    if (monitorRafRef.current) window.cancelAnimationFrame(monitorRafRef.current);
    monitorStreamRef.current?.getTracks().forEach((track) => track.stop());
    monitorStreamRef.current = null;
    if (monitorContextRef.current) void monitorContextRef.current.close();
    monitorContextRef.current = null;
    noisySinceRef.current = 0;
  }

  async function startNoiseMonitor() {
    if (activeRef.current || monitorStreamRef.current || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (activeRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      monitorStreamRef.current = stream;
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new Ctx();
      monitorContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const sample of data) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / data.length);
        levelRef.current = rms;
        // A detecção de palma segue a cada frame; só a publicação no state é
        // afunilada. setLevel a 60fps re-renderizava este componente 60x por
        // segundo enquanto a página estivesse aberta.
        publishLevel(rms);
        detectDoubleClap(rms);
        const threshold = Math.max(0.055, (noiseFloorRef.current ?? 0) * 2.5);
        if (suspendAutoDetectionRef.current) {
          noisySinceRef.current = 0;
        } else if (rms >= threshold) {
          noisySinceRef.current ||= performance.now();
          if (performance.now() - noisySinceRef.current >= 2500 && !autoOptimizationRef.current) {
            autoOptimizationRef.current = true;
            stopNoiseMonitor();
            onAutoOptimize("Percebi ruído persistente. Vou ativar os filtros e calibrar o ambiente automaticamente.");
            window.setTimeout(() => void activateAndCalibrate(), 3500);
            return;
          }
        } else {
          noisySinceRef.current = 0;
        }
        monitorRafRef.current = window.requestAnimationFrame(tick);
      };
      tick();
      setMessage("Monitorando o ruído ambiente para otimização automática.");
    } catch {
      // A Vick continua funcional sem permissão para o monitor automático.
    }
  }

  async function startStream(nextSettings = settings) {
    stopStream();
    stopNoiseMonitor();
    try {
      const audio: MediaTrackConstraints = {};
      for (const key of Object.keys(nextSettings) as FilterKey[]) {
        if (supportedRef.current[key]) audio[key] = nextSettings[key];
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      streamRef.current = stream;
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new Ctx();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const sample of data) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / data.length);
        levelRef.current = rms;
        publishLevel(rms);
        detectDoubleClap(rms);
        rafRef.current = window.requestAnimationFrame(tick);
      };
      tick();
      activeRef.current = true;
      setActive(true);
      setMessage("Filtros nativos aplicados ao fluxo deste microfone.");
      return true;
    } catch {
      setMessage("Não foi possível abrir o microfone. Verifique a permissão do navegador.");
      return false;
    }
  }

  async function toggleFilter(key: FilterKey) {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    window.localStorage.setItem("vick-noise-filters", JSON.stringify(next));
    if (activeRef.current) await startStream(next);
  }

  async function calibrate() {
    if (!activeRef.current || calibrating) return;
    setCalibrating(true);
    setMessage("Fique em silêncio por 3 segundos para medir o ruído ambiente.");
    const samples: number[] = [];
    const timer = window.setInterval(() => samples.push(levelRef.current), 100);
    window.setTimeout(() => {
      window.clearInterval(timer);
      const floor = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
      noiseFloorRef.current = floor;
      setNoiseFloor(floor);
      window.localStorage.setItem("vick-noise-floor", String(floor));
      setCalibrating(false);
      setMessage("Calibração concluída. Fale normalmente para comparar o nível da voz.");
    }, 3000);
  }

  async function activateAndCalibrate() {
    const started = activeRef.current || await startStream(DEFAULTS);
    if (started) await calibrate();
  }

  function deactivateFilters() {
    stopStream();
    autoOptimizationRef.current = false;
    setMessage("Filtros desativados. Monitorando ruído ambiente.");
    void startNoiseMonitor();
  }

  useEffect(() => {
    if (!command || command.id === lastCommandRef.current) return;
    lastCommandRef.current = command.id;
    if (command.type === "activate") {
      void startStream(DEFAULTS);
    } else {
      void activateAndCalibrate();
    }
  }, [command]);

  const meter = Math.min(100, Math.round(level * 320));
  const floorMeter = noiseFloor === null ? 0 : Math.min(100, Math.round(noiseFloor * 320));

  return (
    <section className="vick-panel" aria-label="Otimizador de ruído">
      <div className="vick-panel-head">
        <h2>Otimizador de ruído</h2>
        <span className="v-tag">{active ? "microfone ativo" : "monitor local"}</span>
      </div>
      <div className="vick-noise-panel">
        <div className="vick-noise-meter" aria-label={`Nível do microfone: ${meter}%`}>
          <div><span>Nível ao vivo</span><b>{meter}%</b></div>
          <div className="vick-bar"><i style={{ width: `${meter}%` }} /></div>
          {noiseFloor !== null && <small>Ruído calibrado: {floorMeter}%</small>}
        </div>
        <div className="vick-noise-filters">
          {(Object.keys(settings) as FilterKey[]).map((key) => (
            <label className={supported[key] ? "" : "unsupported"} key={key}>
              <span>{LABELS[key]}<small>{supported[key] ? "suportado" : "indisponível"}</small></span>
              <input checked={settings[key] && Boolean(supported[key])} disabled={!supported[key]} onChange={() => void toggleFilter(key)} type="checkbox" />
            </label>
          ))}
        </div>
        <div className="vick-noise-actions">
          <button className="vick-vbtn primary" onClick={() => active ? deactivateFilters() : void startStream()} type="button">{active ? "Desativar" : "Ativar filtros"}</button>
          <button className="vick-vbtn" disabled={!active || calibrating} onClick={() => void calibrate()} type="button">{calibrating ? "Calibrando…" : "Calibrar ambiente"}</button>
        </div>
        <p className="vick-noise-message">{message}</p>
        <p className="vick-noise-note">A Web Speech API controla a própria captura; a aplicação dos filtros ao reconhecimento depende do navegador.</p>
      </div>
    </section>
  );
}
