"""Protocol RAG (P2_SPEC §5b): deterministic event -> protocol attachment, steps verbatim.

Protocols live in backend/data/protocols/*.md (YAML frontmatter). Content is either public OSHA text
(quoted verbatim, checked against the manual corpus at load time) or our own SOP labelled
"Demo site SOP". The hub attaches the matching protocol to every event before it is published;
no LLM is involved anywhere on this path.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from copilot.knowledge import frontmatter

#: every one of these must map to exactly one protocol, or the hub refuses to start
SAFETY_EVENTS: tuple[str, ...] = (
    "seatbelt_unfastened", "proximity_alert", "fatigue_alert", "tip_over_warning", "v2v_collision_risk",
)
REQUIRED = ("id", "title", "applies_to_events", "severity", "roles", "steps", "escalation", "source")


class ProtocolError(Exception):
    pass


@dataclass(frozen=True)
class Protocol:
    id: str
    title: str
    applies_to_events: tuple[str, ...]
    match: dict[str, Any]
    severity: str
    roles: tuple[str, ...]
    steps: tuple[str, ...]
    escalation: tuple[str, ...]
    source: str
    regulation: dict[str, str] | None
    path: str

    def matches(self, evt: dict[str, Any]) -> bool:
        if evt.get("event") not in self.applies_to_events:
            return False
        data = evt.get("data") or {}
        return all(data.get(k) == v for k, v in self.match.items())

    def ref(self) -> dict[str, Any]:
        """The payload attached to events (contract ProtocolRef) - steps exactly as in the file."""
        return {"id": self.id, "title": self.title, "severity": self.severity, "steps": list(self.steps),
                "escalation": list(self.escalation), "source": self.source, "regulation": self.regulation}


class ProtocolLibrary:
    def __init__(self, protocols: list[Protocol]) -> None:
        self.protocols = protocols
        self.by_id = {p.id: p for p in protocols}

    @classmethod
    def load(cls, directory: Path, corpus_text: str | None = None) -> ProtocolLibrary:
        protocols: list[Protocol] = []
        for path in sorted(directory.glob("*.md")):
            meta, _, raw = frontmatter.read(path)
            missing = [k for k in REQUIRED if k not in meta]
            if missing:
                raise ProtocolError(f"{path.name}: missing {missing}")
            if not meta["steps"] or not all(isinstance(s, str) and s.strip() for s in meta["steps"]):
                raise ProtocolError(f"{path.name}: steps must be non-empty strings")
            for step in meta["steps"]:
                if step not in raw:
                    raise ProtocolError(f"{path.name}: step not verbatim in file: {step!r}")
            reg = meta.get("regulation")
            if reg is not None:
                if not {"citation", "quote"} <= set(reg):
                    raise ProtocolError(f"{path.name}: regulation needs citation + quote")
                if corpus_text is not None and reg["quote"] not in corpus_text:
                    raise ProtocolError(f"{path.name}: regulation quote is not verbatim in the manual corpus")
            src = str(meta["source"])
            if reg is None and "Demo site SOP" not in src:
                raise ProtocolError(f"{path.name}: non-regulatory content must be labelled 'Demo site SOP'")
            protocols.append(Protocol(
                id=meta["id"], title=meta["title"], applies_to_events=tuple(meta["applies_to_events"]),
                match=dict(meta.get("match") or {}), severity=meta["severity"], roles=tuple(meta["roles"]),
                steps=tuple(meta["steps"]), escalation=tuple(meta["escalation"]), source=src, regulation=reg,
                path=str(path),
            ))
        lib = cls(protocols)
        lib.validate()
        return lib

    def validate(self) -> None:
        if len(self.by_id) != len(self.protocols):
            raise ProtocolError("duplicate protocol ids")
        for evt in SAFETY_EVENTS:
            hits = [p.id for p in self.protocols if evt in p.applies_to_events and not p.match]
            if len(hits) != 1:
                raise ProtocolError(f"safety event {evt} must map to exactly one protocol, got {hits}")

    def for_event(self, evt: dict[str, Any]) -> Protocol | None:
        hits = [p for p in self.protocols if p.matches(evt)]
        if len(hits) > 1:
            # a specific (match-conditioned) protocol wins over a general one
            specific = [p for p in hits if p.match]
            hits = specific if len(specific) == 1 else hits[:1]
        return hits[0] if hits else None

    def enrich(self, evt: dict[str, Any]) -> None:
        """Hub event enricher: attach the protocol (deterministic, before publish)."""
        p = self.for_event(evt)
        if p is not None:
            evt["protocol"] = p.ref()

    def list(self) -> list[dict[str, Any]]:
        return [{**p.ref(), "applies_to_events": list(p.applies_to_events), "match": p.match,
                 "roles": list(p.roles)} for p in self.protocols]
