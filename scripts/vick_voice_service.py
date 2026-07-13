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
WAKE_PATTERN = re.compile(r"\b(vick|vic|vik|vicky)\b", re.IGNORECASE)


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

    @staticmethod
    def _clean(text: str) -> str:
        return re.sub(r"\s+", " ", text).strip()

    def publish(self, transcript: str) -> dict[str, Any] | None:
        match = WAKE_PATTERN.search(transcript)
        if not match:
            return None
        command = transcript[match.end():].lstrip(" ,;:.-").strip()
        if not command:
            return None
        with self.lock:
            self.sequence += 1
            event = {
                "id": self.sequence,
                "timestamp": time.time(),
                "transcript": transcript.strip(),
                "command": command,
                "source": "faster_whisper_local",
            }
            self.events.append(event)
            return event

    def _publish_command(self, transcript: str, command: str) -> dict[str, Any] | None:
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
                "source": "faster_whisper_local",
            }
            self.events.append(event)
            return event

    def ingest(self, transcript: str) -> None:
        clean = self._clean(transcript)
        if not clean:
            return

        match = WAKE_PATTERN.search(clean)
        now = time.time()

        if match:
            command = clean[match.end():].lstrip(" ,;:.-").strip()
            self.pending_transcript = clean
            self.pending_command = self._clean(command)
            self.pending_last_activity = now
            self.pending_active = True
            return

        if self.pending_active:
            self.pending_transcript = self._clean(f"{self.pending_transcript} {clean}")
            self.pending_command = self._clean(f"{self.pending_command} {clean}")
            self.pending_last_activity = now

    def flush_if_idle(self, idle_seconds: float) -> dict[str, Any] | None:
        if not self.pending_active:
            return None
        if time.time() - self.pending_last_activity < idle_seconds:
            return None

        transcript = self.pending_transcript
        command = self.pending_command
        self.pending_transcript = ""
        self.pending_command = ""
        self.pending_last_activity = 0.0
        self.pending_active = False
        return self._publish_command(transcript, command)

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
            if float(np.sqrt(np.mean(mono * mono))) < 0.006:
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
                state.ingest(transcript)
            state.flush_if_idle(command_idle_seconds)
    except Exception as exc:  # runtime diagnostics must remain available over /health
        state.error = f"{type(exc).__name__}: {exc}"
        state.engine_ready = False
        state.listening = False


class Handler(BaseHTTPRequestHandler):
    state: VoiceState

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1:3000")
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
    parser.add_argument("--model", default="tiny")
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
