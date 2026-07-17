#!/usr/bin/env python3
"""Servico local de wake word e transcricao da Vick.

Captura audio somente na maquina, transcreve com Faster Whisper e publica
comandos para o AdoneX e para a interface web. Nenhum audio e persistido.
"""

from __future__ import annotations

import argparse
import json
import re
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = "127.0.0.1"
# Cobre "Vick" e as transcricoes comuns do Whisper/Web Speech em pt-BR
# (vic, vik, vique, viqui, vicky/vicki/vickie, bick). Mantenha em sincronia
# com o mesmo padrao no frontend (frontend/app/page.tsx).
# Wake word de DUAS palavras ("Ei Vick"), no espirito do "Hey Jarvis": um nome
# curto de uma silaba e o pior caso para ASR ("Vick" vira "big"/"bic"/"vique").
# O prefixo da contexto acustico e derruba o erro.
# Mantenha em sincronia com WAKE_WORD_RE em frontend/app/page.tsx.
# "vem" no fim: paridade com o navegador, onde o Web Speech pt-BR transcreve
# "viqui" como "vem". Vem por último para não engolir "vem aqui" na alternância.
_VICK_CORE_SAFE = r"vick(?:y|i|ie)?|vic|vik|vique|viqui|bick|vem"
# Homofonos arriscados: so valem DEPOIS do prefixo, senao disparam sozinhos.
_VICK_CORE_LOOSE = _VICK_CORE_SAFE + r"|big|bic|nick|pick|quick|week"
_WAKE_PREFIX = r"(?:ei|e|ol[aá]|oi|al[oô]|hey)"
WAKE_PATTERN = re.compile(
    rf"\b(?:{_WAKE_PREFIX}[\s,]+(?:{_VICK_CORE_LOOSE})|(?:{_VICK_CORE_SAFE}))\b",
    re.IGNORECASE,
)
# Depois de ativar pela wake word, quanto tempo aguardar o comando antes de desarmar.
ARM_TIMEOUT_SECONDS = 9.0
# Um comando valido precisa conter ao menos uma letra (filtra lixo do Whisper
# como "1523.", "!" ou repeticoes soltas da propria wake word).
HAS_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


class VoiceState:
    def __init__(self, wake_word: str) -> None:
        self.wake_word = wake_word
        self.events: deque[dict[str, Any]] = deque(maxlen=200)
        self.sequence = 0
        self.lock = threading.Lock()
        self.listening = False
        self.engine_ready = False
        self.error = ""
        self.pending_transcript = ""
        self.pending_command = ""
        self.pending_last_activity = 0.0
        self.pending_active = False
        self.pending_emitted = ""
        # Ativacao em duas fases: a wake word "arma" a Vick; a proxima fala vira
        # o comando. armed_at marca quando a wake word foi ouvida.
        self.armed = False
        self.armed_at = 0.0
        # Diagnostico do microfone (usado pelo botao "Testar microfone" no front):
        # ultimo nivel de audio e ultima transcricao crua, mesmo sem wake word.
        self.last_level = 0.0
        self.last_transcript = ""
        self.last_transcript_at = 0.0

    @staticmethod
    def _clean(text: str) -> str:
        return re.sub(r"\s+", " ", text).strip()

    def _emit(self, transcript: str, command: str, partial: bool) -> dict[str, Any] | None:
        command = self._clean(command)
        if not command:
            return None
        with self.lock:
            self.sequence += 1
            event = {
                "id": self.sequence,
                "timestamp": time.time(),
                "transcript": self._clean(transcript),
                "command": command,
                # partial=True: texto sendo digitado ao vivo no campo enquanto o
                # usuario fala. partial=False: fim da fala, o front envia o comando.
                "partial": partial,
                "source": "faster_whisper_local",
            }
            self.events.append(event)
            return event

    def _strip_wake(self, text: str) -> str:
        # Remove TODAS as ocorrencias da wake word; o que sobra e o comando.
        return self._clean(WAKE_PATTERN.sub(" ", text))

    def _reset_pending(self) -> None:
        self.pending_transcript = ""
        self.pending_command = ""
        self.pending_last_activity = 0.0
        self.pending_active = False
        self.pending_emitted = ""
        self.armed = False
        self.armed_at = 0.0

    def publish(self, transcript: str) -> dict[str, Any] | None:
        if not WAKE_PATTERN.search(transcript):
            return None
        return self._emit(transcript, self._strip_wake(transcript), partial=False)

    def _emit_partial(self) -> None:
        # Publica o comando parcial apenas quando ele muda, para o front ir
        # digitando no campo sem spam de eventos identicos.
        command = self._clean(self.pending_command)
        if not command or command == self.pending_emitted:
            return
        self.pending_emitted = command
        self._emit(self.pending_transcript, command, partial=True)

    def ingest(self, transcript: str) -> None:
        clean = self._clean(transcript)
        if not clean:
            return

        now = time.time()

        if WAKE_PATTERN.search(clean):
            # Fase 1: a wake word ATIVA a Vick. Removemos todas as ocorrencias da
            # wake word; se sobrar texto na mesma fala, ele ja e o comando.
            if not self.armed:
                self.armed = True
                self.armed_at = now
            self.pending_active = True
            self.pending_transcript = clean
            self.pending_command = self._strip_wake(clean)
            self.pending_last_activity = now
            self._emit_partial()
            return

        if self.pending_active:
            # Fase 2: acumula o comando falado depois da ativacao.
            self.pending_transcript = self._clean(f"{self.pending_transcript} {clean}")
            self.pending_command = self._strip_wake(f"{self.pending_command} {clean}")
            self.pending_last_activity = now
            self._emit_partial()

    def flush_if_idle(self, idle_seconds: float) -> dict[str, Any] | None:
        if not self.pending_active:
            return None
        now = time.time()
        if now - self.pending_last_activity < idle_seconds:
            return None

        command = self._strip_wake(self.pending_command)
        if command and HAS_LETTER.search(command):
            # Comando valido: envia e desarma.
            transcript = self.pending_transcript
            self._reset_pending()
            return self._emit(transcript, command, partial=False)

        # Ativada, mas ainda sem comando util: continua ouvindo ate o arm timeout,
        # para o usuario poder falar "Vick" e so depois dizer o comando.
        if now - self.armed_at >= ARM_TIMEOUT_SECONDS:
            self._reset_pending()
        return None

    def after(self, event_id: int) -> list[dict[str, Any]]:
        with self.lock:
            return [event for event in self.events if event["id"] > event_id]


def microphone_loop(state: VoiceState, model_name: str, seconds: float, command_idle_seconds: float) -> None:
    try:
        import numpy as np
        import sounddevice as sd
        from faster_whisper import WhisperModel

        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        state.engine_ready = True
        state.listening = True
        sample_rate = 16000
        while True:
            audio = sd.rec(
                int(seconds * sample_rate),
                samplerate=sample_rate,
                channels=1,
                dtype="float32",
            )
            sd.wait()
            mono = np.asarray(audio).reshape(-1)
            rms = float(np.sqrt(np.mean(mono * mono)))
            state.last_level = rms
            if rms < 0.006:
                state.flush_if_idle(command_idle_seconds)
                continue
            segments, _ = model.transcribe(
                mono,
                language="pt",
                beam_size=1,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            transcript = " ".join(segment.text.strip() for segment in segments).strip()
            if transcript:
                state.last_transcript = transcript
                state.last_transcript_at = time.time()
                state.ingest(transcript)
            state.flush_if_idle(command_idle_seconds)
    except Exception as exc:  # runtime diagnostics must remain available over /health
        state.error = f"{type(exc).__name__}: {exc}"
        state.engine_ready = False
        state.listening = False


class Handler(BaseHTTPRequestHandler):
    state: VoiceState

    def _allowed_origin(self) -> str:
        # Reflete a origem quando for local (localhost OU 127.0.0.1, qualquer porta).
        # Antes fixava 127.0.0.1:3000, entao abrir por "localhost:3000" era
        # bloqueado pelo navegador (CORS) e o front nao recebia nada.
        origin = self.headers.get("Origin", "")
        if re.match(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$", origin):
            return origin
        return "http://127.0.0.1:3000"

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", self._allowed_origin())
        self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path, _, query = self.path.partition("?")
        if path == "/health":
            self._send(200, {
                "ok": True,
                "service": "vick-voice-local",
                "engine": "faster_whisper",
                "engineReady": self.state.engine_ready,
                "listening": self.state.listening,
                "wakeWord": self.state.wake_word,
                "error": self.state.error or None,
                "armed": self.state.armed,
                "level": round(self.state.last_level, 4),
                "heard": self.state.last_level >= 0.006,
                "lastTranscript": self.state.last_transcript,
                "lastTranscriptAgeMs": (
                    int((time.time() - self.state.last_transcript_at) * 1000)
                    if self.state.last_transcript_at
                    else None
                ),
            })
            return
        if path == "/events":
            params = dict(item.split("=", 1) for item in query.split("&") if "=" in item)
            try:
                after = max(0, int(params.get("after", "0")))
            except ValueError:
                self._send(400, {"detail": "after deve ser inteiro"})
                return
            self._send(200, {"events": self.state.after(after)})
            return
        self._send(404, {"detail": "rota inexistente"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/events":
            self._send(404, {"detail": "rota inexistente"})
            return
        length = min(int(self.headers.get("Content-Length", "0")), 16_384)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            transcript = str(payload.get("transcript", "")).strip()
        except (ValueError, json.JSONDecodeError):
            self._send(400, {"detail": "JSON invalido"})
            return
        event = self.state.publish(transcript)
        self._send(202 if event else 200, {"accepted": event is not None, "event": event})

    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> int:
    parser = argparse.ArgumentParser(description="Vick local voice service")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--wake-word", default="Vick")
    parser.add_argument("--model", default="small")
    parser.add_argument("--window-seconds", type=float, default=2.0)
    parser.add_argument("--command-idle-seconds", type=float, default=1.8)
    parser.add_argument("--no-microphone", action="store_true")
    args = parser.parse_args()

    print("iniciando servico de voz local da Vick", flush=True)
    state = VoiceState(args.wake_word)
    Handler.state = state
    if not args.no_microphone:
        threading.Thread(
            target=microphone_loop,
            args=(state, args.model, max(1.5, args.window_seconds), max(0.8, args.command_idle_seconds)),
            daemon=True,
        ).start()
    server = ThreadingHTTPServer((HOST, args.port), Handler)
    print(f"Vick voice local em http://{HOST}:{args.port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
