import json
import os
import secrets
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core_config import Settings, get_settings


class PeerMessagingError(RuntimeError):
    pass


class PeerMessagingService:
    """Local SQLite peer registry and mailbox for Codex, Claude, and Ruflo."""

    def __init__(self, settings: Settings | None = None, db_path: str | None = None) -> None:
        self.settings = settings or get_settings()
        self.db_path = Path(db_path or self.settings.peer_messaging_db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def register(
        self,
        *,
        peer_type: str,
        cwd: str,
        summary: str = "",
        pid: int | None = None,
        git_root: str | None = None,
        role: str = "",
        capabilities: list[str] | None = None,
        model_profile: str = "",
        active_agents: int | None = None,
        status: str = "active",
    ) -> dict[str, Any]:
        self.cleanup_stale_peers()
        normalized_type = self._validate_peer_type(peer_type)
        peer_id = f"{normalized_type}-{secrets.token_hex(4)}"
        process_id = int(pid or os.getpid())
        now = self._now()
        trimmed_summary = self._limit_text(
            summary,
            self.settings.peer_messaging_max_summary_chars,
            "summary",
        )
        with self._connect() as db:
            db.execute("DELETE FROM peers WHERE pid = ?", (process_id,))
            db.execute(
                """
                INSERT INTO peers
                    (
                        id, peer_type, pid, cwd, git_root, summary, role,
                        capabilities_json, model_profile, active_agents, status,
                        registered_at, last_seen
                    )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    peer_id,
                    normalized_type,
                    process_id,
                    str(Path(cwd).resolve()),
                    str(Path(git_root).resolve()) if git_root else self._git_root(cwd),
                    trimmed_summary,
                    self._limit_optional_text(role, 120),
                    json.dumps(capabilities or [], ensure_ascii=True),
                    self._limit_optional_text(model_profile, 80),
                    self._validate_active_agents(active_agents),
                    self._validate_status(status),
                    now,
                    now,
                ),
            )
        return self._peer(peer_id)

    def heartbeat(self, peer_id: str) -> dict[str, Any]:
        with self._connect() as db:
            updated = db.execute(
                "UPDATE peers SET last_seen = ? WHERE id = ?",
                (self._now(), peer_id),
            ).rowcount
        if not updated:
            raise PeerMessagingError(f"Peer {peer_id!r} is not registered")
        return self._peer(peer_id)

    def set_summary(self, peer_id: str, summary: str) -> dict[str, Any]:
        trimmed = self._limit_text(
            summary,
            self.settings.peer_messaging_max_summary_chars,
            "summary",
        )
        with self._connect() as db:
            updated = db.execute(
                "UPDATE peers SET summary = ?, last_seen = ? WHERE id = ?",
                (trimmed, self._now(), peer_id),
            ).rowcount
        if not updated:
            raise PeerMessagingError(f"Peer {peer_id!r} is not registered")
        return self._peer(peer_id)

    def publish_context(
        self,
        peer_id: str,
        *,
        summary: str,
        role: str = "",
        capabilities: list[str] | None = None,
        model_profile: str = "",
        active_agents: int | None = None,
        status: str = "active",
    ) -> dict[str, Any]:
        trimmed = self._limit_text(
            summary,
            self.settings.peer_messaging_max_summary_chars,
            "summary",
        )
        with self._connect() as db:
            updated = db.execute(
                """
                UPDATE peers
                SET summary = ?, role = ?, capabilities_json = ?,
                    model_profile = ?, active_agents = ?, status = ?, last_seen = ?
                WHERE id = ?
                """,
                (
                    trimmed,
                    self._limit_optional_text(role, 120),
                    json.dumps(capabilities or [], ensure_ascii=True),
                    self._limit_optional_text(model_profile, 80),
                    self._validate_active_agents(active_agents),
                    self._validate_status(status),
                    self._now(),
                    peer_id,
                ),
            ).rowcount
        if not updated:
            raise PeerMessagingError(f"Peer {peer_id!r} is not registered")
        return self._peer(peer_id)

    def list_peers(
        self,
        *,
        scope: str = "repo",
        cwd: str | None = None,
        git_root: str | None = None,
        exclude_id: str | None = None,
        limit: int = 10,
    ) -> dict[str, Any]:
        self.cleanup_stale_peers()
        normalized_scope = self._validate_scope(scope)
        resolved_cwd = str(Path(cwd or os.getcwd()).resolve())
        resolved_git_root = str(Path(git_root).resolve()) if git_root else self._git_root(resolved_cwd)

        query = "SELECT * FROM peers"
        params: list[Any] = []
        if normalized_scope == "directory":
            query += " WHERE cwd = ?"
            params.append(resolved_cwd)
        elif normalized_scope == "repo":
            if resolved_git_root:
                query += " WHERE git_root = ?"
                params.append(resolved_git_root)
            else:
                query += " WHERE cwd = ?"
                params.append(resolved_cwd)
        query += " ORDER BY last_seen DESC LIMIT ?"
        params.append(max(1, min(int(limit), 50)))

        with self._connect() as db:
            peers = [self._row_to_peer(row) for row in db.execute(query, params).fetchall()]
        if exclude_id:
            peers = [peer for peer in peers if peer["id"] != exclude_id]
        return {
            "peers": peers,
            "scope": normalized_scope,
            "token_savings": "Use peer summaries first; request details only when needed.",
            "estimated_summary_tokens": sum(self._estimate_tokens(peer.get("summary", "")) for peer in peers),
        }

    def send_message(self, *, from_id: str, to_id: str, message: str) -> dict[str, Any]:
        text = self._limit_text(
            message,
            self.settings.peer_messaging_max_message_chars,
            "message",
        )
        with self._connect() as db:
            sender = db.execute("SELECT id FROM peers WHERE id = ?", (from_id,)).fetchone()
            target = db.execute("SELECT id FROM peers WHERE id = ?", (to_id,)).fetchone()
            if not sender:
                raise PeerMessagingError(f"Sender {from_id!r} is not registered")
            if not target:
                raise PeerMessagingError(f"Target {to_id!r} is not registered")
            db.execute(
                """
                INSERT INTO messages (from_id, to_id, text, sent_at, delivered)
                VALUES (?, ?, ?, ?, 0)
                """,
                (from_id, to_id, text, self._now()),
            )
            db.execute("UPDATE peers SET last_seen = ? WHERE id = ?", (self._now(), from_id))
        return {
            "ok": True,
            "from_id": from_id,
            "to_id": to_id,
            "message_chars": len(text),
            "estimated_tokens": self._estimate_tokens(text),
            "cost_control": "Short peer message stored locally; no cloud provider used.",
        }

    def announce_task(
        self,
        *,
        from_id: str,
        objective: str,
        target_peer_type: str = "ruflo",
        required_agents: list[str] | None = None,
    ) -> dict[str, Any]:
        normalized_type = self._validate_peer_type(target_peer_type)
        text = self._limit_text(
            self._task_message(objective, required_agents or []),
            self.settings.peer_messaging_max_message_chars,
            "task",
        )
        with self._connect() as db:
            sender = db.execute("SELECT id FROM peers WHERE id = ?", (from_id,)).fetchone()
            if not sender:
                raise PeerMessagingError(f"Sender {from_id!r} is not registered")
            targets = db.execute(
                """
                SELECT id FROM peers
                WHERE peer_type = ? AND id != ? AND status IN ('active', 'idle')
                ORDER BY last_seen DESC
                LIMIT 20
                """,
                (normalized_type, from_id),
            ).fetchall()
            now = self._now()
            for target in targets:
                db.execute(
                    """
                    INSERT INTO messages (from_id, to_id, text, sent_at, delivered)
                    VALUES (?, ?, ?, ?, 0)
                    """,
                    (from_id, target["id"], text, now),
                )
            db.execute("UPDATE peers SET last_seen = ? WHERE id = ?", (now, from_id))
        return {
            "ok": True,
            "from_id": from_id,
            "target_peer_type": normalized_type,
            "targeted_peers": [target["id"] for target in targets],
            "targeted_count": len(targets),
            "required_agents": required_agents or [],
            "estimated_tokens": self._estimate_tokens(text),
            "cost_control": "Task announcement stayed local; Ruflo/Ollama execution is not triggered automatically.",
        }

    def check_messages(self, peer_id: str, *, mark_delivered: bool = True, limit: int = 10) -> dict[str, Any]:
        with self._connect() as db:
            peer = db.execute("SELECT id FROM peers WHERE id = ?", (peer_id,)).fetchone()
            if not peer:
                raise PeerMessagingError(f"Peer {peer_id!r} is not registered")
            rows = db.execute(
                """
                SELECT messages.*, peers.peer_type AS from_type, peers.cwd AS from_cwd,
                       peers.summary AS from_summary
                FROM messages
                LEFT JOIN peers ON peers.id = messages.from_id
                WHERE messages.to_id = ? AND messages.delivered = 0
                ORDER BY messages.sent_at ASC
                LIMIT ?
                """,
                (peer_id, max(1, min(int(limit), 50))),
            ).fetchall()
            messages = [dict(row) for row in rows]
            if mark_delivered:
                for message in messages:
                    db.execute("UPDATE messages SET delivered = 1 WHERE id = ?", (message["id"],))
            db.execute("UPDATE peers SET last_seen = ? WHERE id = ?", (self._now(), peer_id))
        return {
            "messages": messages,
            "message_count": len(messages),
            "estimated_tokens": sum(self._estimate_tokens(item.get("text", "")) for item in messages),
            "cost_control": "Read only pending local messages; avoid replaying full context.",
        }

    def cleanup_stale_peers(self) -> dict[str, int]:
        removed = 0
        with self._connect() as db:
            peers = db.execute("SELECT id, pid FROM peers").fetchall()
            for peer in peers:
                if not self._pid_alive(int(peer["pid"])):
                    db.execute("DELETE FROM peers WHERE id = ?", (peer["id"],))
                    db.execute("DELETE FROM messages WHERE to_id = ? AND delivered = 0", (peer["id"],))
                    removed += 1
        return {"removed": removed}

    def _init_db(self) -> None:
        with self._connect() as db:
            db.execute("PRAGMA journal_mode = WAL")
            db.execute("PRAGMA busy_timeout = 3000")
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS peers (
                    id TEXT PRIMARY KEY,
                    peer_type TEXT NOT NULL,
                    pid INTEGER NOT NULL,
                    cwd TEXT NOT NULL,
                    git_root TEXT,
                    summary TEXT NOT NULL DEFAULT '',
                    role TEXT NOT NULL DEFAULT '',
                    capabilities_json TEXT NOT NULL DEFAULT '[]',
                    model_profile TEXT NOT NULL DEFAULT '',
                    active_agents INTEGER,
                    status TEXT NOT NULL DEFAULT 'active',
                    registered_at TEXT NOT NULL,
                    last_seen TEXT NOT NULL
                )
                """
            )
            self._ensure_peer_columns(db)
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    from_id TEXT NOT NULL,
                    to_id TEXT NOT NULL,
                    text TEXT NOT NULL,
                    sent_at TEXT NOT NULL,
                    delivered INTEGER NOT NULL DEFAULT 0
                )
                """
            )

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.db_path)
        db.row_factory = sqlite3.Row
        return db

    def _peer(self, peer_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM peers WHERE id = ?", (peer_id,)).fetchone()
        if not row:
            raise PeerMessagingError(f"Peer {peer_id!r} is not registered")
        return self._row_to_peer(row)

    @staticmethod
    def _ensure_peer_columns(db: sqlite3.Connection) -> None:
        existing = {row["name"] for row in db.execute("PRAGMA table_info(peers)").fetchall()}
        columns = {
            "role": "TEXT NOT NULL DEFAULT ''",
            "capabilities_json": "TEXT NOT NULL DEFAULT '[]'",
            "model_profile": "TEXT NOT NULL DEFAULT ''",
            "active_agents": "INTEGER",
            "status": "TEXT NOT NULL DEFAULT 'active'",
        }
        for name, ddl in columns.items():
            if name not in existing:
                db.execute(f"ALTER TABLE peers ADD COLUMN {name} {ddl}")

    @staticmethod
    def _row_to_peer(row: sqlite3.Row) -> dict[str, Any]:
        peer = dict(row)
        raw_capabilities = peer.pop("capabilities_json", "[]")
        try:
            capabilities = json.loads(raw_capabilities or "[]")
        except json.JSONDecodeError:
            capabilities = []
        peer["capabilities"] = capabilities if isinstance(capabilities, list) else []
        return peer

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _validate_scope(scope: str) -> str:
        normalized = scope.strip().lower()
        if normalized not in {"machine", "directory", "repo"}:
            raise PeerMessagingError("scope must be machine, directory, or repo")
        return normalized

    @staticmethod
    def _validate_peer_type(peer_type: str) -> str:
        normalized = peer_type.strip().lower().replace("_", "-")
        if normalized not in {"codex", "claude", "adonex", "ruflo", "ollama", "human", "other"}:
            raise PeerMessagingError("peer_type must be codex, claude, adonex, ruflo, ollama, human, or other")
        return normalized

    @staticmethod
    def _validate_status(status: str) -> str:
        normalized = status.strip().lower().replace("_", "-")
        if normalized not in {"active", "idle", "busy", "offline"}:
            raise PeerMessagingError("status must be active, idle, busy, or offline")
        return normalized

    @staticmethod
    def _validate_active_agents(active_agents: int | None) -> int | None:
        if active_agents is None:
            return None
        value = int(active_agents)
        if value < 0 or value > 60:
            raise PeerMessagingError("active_agents must be between 0 and 60")
        return value

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        return max(1, (len(text) + 3) // 4) if text else 0

    @staticmethod
    def _limit_text(text: str, max_chars: int, label: str) -> str:
        clean = " ".join(str(text).split())
        if len(clean) > max_chars:
            raise PeerMessagingError(
                f"{label} is too long ({len(clean)} chars); limit is {max_chars}. "
                "Send a summary first, then ask for specific details."
            )
        return clean

    @staticmethod
    def _limit_optional_text(text: str, max_chars: int) -> str:
        return " ".join(str(text or "").split())[:max_chars]

    @staticmethod
    def _task_message(objective: str, required_agents: list[str]) -> str:
        agents = ", ".join(required_agents[:60]) if required_agents else "auto"
        return (
            "SYNAPSE_TASK "
            f"objective={objective.strip()} "
            f"required_agents={agents} "
            "routing=local_first provider=ollama cloud=false"
        )

    @staticmethod
    def _git_root(cwd: str) -> str | None:
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if result.returncode != 0:
            return None
        return str(Path(result.stdout.strip()).resolve())

    @staticmethod
    def _pid_alive(pid: int) -> bool:
        if pid <= 0:
            return False
        if pid == os.getpid():
            return True
        if os.name == "nt":
            try:
                result = subprocess.run(
                    ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                    capture_output=True,
                    text=True,
                    timeout=3,
                    check=False,
                )
            except (OSError, subprocess.SubprocessError):
                return True
            return str(pid) in result.stdout
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True
