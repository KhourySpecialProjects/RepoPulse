"""Normalising, fingerprinting and fencing the instructor's grading rubric.

These three live together because they have to agree. The fingerprint is the
cache key for every commit score, the normalised text is what gets hashed, and
the fenced text is what actually reaches the model — if any two of them
disagreed about what "the rubric" is, scores would either be re-graded on every
request or cached under a rubric that never produced them.
"""
from __future__ import annotations

import hashlib
import re

# ~2k tokens. The rubric is re-sent with every chunk of commits, not once per
# request, so its length is a cost multiplier rather than a one-off.
MAX_CRITERIA_CHARS = 8000


def normalize_criteria(criteria: str | None) -> str:
    """Canonical form: LF line endings, no surrounding whitespace.

    Folding CRLF is load-bearing, not cosmetic. A browser textarea submits
    \\r\\n on some platforms, so without this the same rubric saved from two
    machines fingerprints differently and silently re-grades every cached
    commit in the collection.
    """
    if not criteria:
        return ""
    return criteria.replace("\r\n", "\n").replace("\r", "\n").strip()


def criteria_fingerprint(criteria: str | None) -> str | None:
    """SHA-256 of the normalised rubric, or None when there is no rubric."""
    text = normalize_criteria(criteria)
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if text else None


def fence(criteria: str | None, tag: str) -> str:
    """The rubric, made safe to drop inside <tag>…</tag>.

    Stripping the tag out of the body stops the rubric closing its own block:
    anything after a premature </tag> would read as top-level instruction
    rather than as the fenced-off data it is. The instructor is trusted, but
    they are writing prose, not a prompt, and a stray tag should not be able to
    reach past the output contract.
    """
    text = normalize_criteria(criteria)
    if not text:
        return ""
    text = re.sub(rf"</?\s*{re.escape(tag)}\s*>", "", text, flags=re.IGNORECASE)
    if len(text) > MAX_CRITERIA_CHARS:
        text = text[:MAX_CRITERIA_CHARS].rstrip() + "\n… [rubric truncated]"
    return text
