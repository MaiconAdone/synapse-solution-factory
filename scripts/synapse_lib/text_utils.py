"""Standard-library text helpers.

Kept dependency-free on purpose: the business solution analyzer imports this
module and runs under whatever ``python`` the project factory finds on PATH.
"""

import re
import unicodedata


def normalize_text(value: str) -> str:
    without_accents = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", without_accents.lower()).strip()


def tokenize(value: str) -> list[str]:
    return re.findall(r"[a-z0-9_]+", normalize_text(value))
