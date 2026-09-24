"""Manual RAG (P2_SPEC §6).

Corpus (see `corpus_dirs`):
  * backend/data/manuals/*.md - eCFR sections (public domain, cited by section/paragraph) and the team's
    demo site manual (cited by page). Real machine manuals go here too when we have them.
  * backend/data/synthetic/**/*.md - synthetic demo knowledge (`kind: synthetic`), cited by section and
    always marked `synthetic` so it can never pass for an official publication.
Every document has a `domain` (regulation, site_manual, training, safety, machine, maintenance) so a
specialist can weight its own domains (copilot/knowledge/retrieval.py) on the one shared index.
Retrieval:
  1. fault-code regex exact match first (e.g. HYD-118)
  2. BM25 (rank-bm25) + cosine over local fastembed embeddings, fused with reciprocal-rank fusion
  3. nothing relevant -> "not in the manuals" (no LLM call)
`make index` builds backend/data/index/{chunks.json, embeddings.npy, meta.json}. At runtime, if the
embedding model can't be loaded, search is BM25-only and says so in its provenance.
"""

from __future__ import annotations

import hashlib
import json
import re
import zlib
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from copilot.knowledge import frontmatter
from copilot.knowledge.retrieval import RetrievalProfile

FAULT_RE = re.compile(r"\b[A-Z]{2,4}-\d{2,4}\b")
TOKEN_RE = re.compile(r"[a-z0-9]+(?:-[0-9]+)?")
PAGE_RE = re.compile(r"<!--\s*page\s+(\d+)\s*-->")
SECTION_RE = re.compile(r"^## +(.+)$", re.MULTILINE)
PARA_RE = re.compile(r"^\(([a-z]{1,4}|\d+)\)")
DEF_RE = re.compile(r"^[A-Z][A-Za-z ()/-]{2,60} means ")  # "Competent person means one who ..."
STOP = set("a an the of to and or in on for is are be by with as at from that this it shall any".split())
RRF_K = 60
#: Real documents outrank synthetic demo knowledge on equal evidence; a specialist profile can still lift
#: a synthetic domain (training notes for a trainee) above that.
SYNTHETIC_WEIGHT = 0.7
MAX_WORDS = 220
MIN_COSINE = 0.55


@dataclass
class Chunk:
    chunk_id: str
    doc_id: str
    title: str
    citation: str  # e.g. "29 CFR 1926.651(e)" or "Demo site manual (CAT Copilot hackathon), p. 2"
    page: int | None
    section: str | None
    text: str
    source: str
    domain: str = "general"  # regulation | site_manual | training | safety | machine | maintenance
    kind: str = "manual"  # manual | synthetic

    @property
    def synthetic(self) -> bool:
        return self.kind == "synthetic"


_SUFFIXES = ("ations", "ation", "ions", "ion", "ings", "ing", "edly", "ed", "ies", "es", "s", "ly")


def _stem(tok: str) -> str:
    """Light suffix stripping so "loads"/"load" and "inspections"/"inspect" meet in BM25."""
    for suf in _SUFFIXES:
        if tok.endswith(suf) and len(tok) - len(suf) >= 4:
            return tok[: -len(suf)] + ("y" if suf == "ies" else "")
    return tok


def tokenize(text: str) -> list[str]:
    return [_stem(t) for t in TOKEN_RE.findall(text.lower()) if t not in STOP]


def _cfr_chunks(meta: dict[str, Any], body: str) -> list[Chunk]:
    chunks: list[Chunk] = []
    letter = None
    buf: list[str] = []
    label = None

    def flush() -> None:
        if buf:
            sec = f"{meta['citation'].split()[-1]}{label or ''}"
            chunks.append(Chunk(f"{meta['doc_id']}#{len(chunks)}", meta["doc_id"], meta["title"],
                                f"29 CFR {sec}", None, sec, "\n".join(buf), meta["source"], *_labels(meta)))

    for para in [p.strip() for p in body.splitlines() if p.strip()]:
        m = PARA_RE.match(para)
        if m and m.group(1).isalpha() and len(m.group(1)) == 1 and (letter is None or ord(m.group(1)) == ord(letter) + 1):
            letter = m.group(1)
            flush()
            buf, label = [para], f"({letter})"
            continue
        if DEF_RE.match(para):  # each definition is its own chunk (definitions lists dilute BM25)
            flush()
            buf = [para]
            flush()
            buf = []
            continue
        if sum(len(x.split()) for x in buf) + len(para.split()) > MAX_WORDS and buf:
            flush()
            buf = []
            num = m.group(1) if m and m.group(1).isdigit() else None
            label = f"({letter})" + (f"({num})" if num else "") if letter else label
        elif m and m.group(1).isdigit() and letter and len(buf) == 0:
            label = f"({letter})({m.group(1)})"
        buf.append(para)
    flush()
    return chunks


def _paged_chunks(meta: dict[str, Any], body: str) -> list[Chunk]:
    chunks: list[Chunk] = []
    parts = PAGE_RE.split(body)
    # parts = [before, page_no, text, page_no, text, ...]
    for i in range(1, len(parts), 2):
        page = int(parts[i])
        text = parts[i + 1].strip()
        if text:
            chunks.append(Chunk(f"{meta['doc_id']}#p{page}", meta["doc_id"], meta["title"],
                                f"{meta['citation']}, p. {page}", page, None, text, meta["source"], *_labels(meta)))
    return chunks


def _section_chunks(meta: dict[str, Any], body: str) -> list[Chunk]:
    """Synthetic documents: one chunk per `## heading`, cited as "<citation>, §n <heading>"."""
    chunks: list[Chunk] = []
    heads = list(SECTION_RE.finditer(body))
    for n, m in enumerate(heads, 1):
        end = heads[n].start() if n < len(heads) else len(body)
        text = body[m.end():end].strip()
        if text:
            head = m.group(1).strip()
            chunks.append(Chunk(f"{meta['doc_id']}#s{n}", meta["doc_id"], meta["title"],
                                f"{meta['citation']}, §{n} {head}", None, head, f"{head}. {text}", meta["source"],
                                *_labels(meta)))
    return chunks


def _labels(meta: dict[str, Any]) -> tuple[str, str]:
    kind = "synthetic" if meta.get("kind") == "synthetic" else "manual"
    return str(meta.get("domain") or "general"), kind


def _documents(directory: Path) -> list[Path]:
    return [p for p in sorted(directory.rglob("*.md")) if p.name.lower() != "readme.md"]


def load_chunks(directory: Path) -> list[Chunk]:
    out: list[Chunk] = []
    for path in _documents(directory):
        meta, body, _ = frontmatter.read(path)
        if meta.get("kind") == "synthetic":
            out += _section_chunks(meta, body)
        else:
            out += _paged_chunks(meta, body) if PAGE_RE.search(body) else _cfr_chunks(meta, body)
    return out


def corpus_dirs(data_dir: Path) -> list[Path]:
    """Every directory the RAG index covers. Real manuals and synthetic knowledge stay apart on disk."""
    return [d for d in (data_dir / "manuals", data_dir / "synthetic") if d.is_dir()]


def fingerprint(dirs: Sequence[Path]) -> str:
    """Content hash of the corpus, stored with the index so a stale index is noticed, never served."""
    h = hashlib.sha256()
    for d in dirs:
        for p in _documents(d):
            h.update(p.name.encode())
            h.update(p.read_bytes())
    return h.hexdigest()[:16]


def corpus_text(directory: Path) -> str:
    """Body text of the real (non-synthetic) documents; protocol regulation quotes are checked against it."""
    return "\n".join(frontmatter.read(p)[1] for p in _documents(directory))


# --------------------------------------------------------------------------- embeddings


class Embedder(Protocol):
    name: str

    def embed(self, texts: Sequence[str]) -> np.ndarray: ...  # (n, d), L2-normalised


class FastEmbedder:
    """Local ONNX model via fastembed. Only `make index` may download it (download=True); the running
    hub loads it from local files only, so it never touches the network."""

    name = "BAAI/bge-small-en-v1.5"

    def __init__(self, cache_dir: Path, download: bool = False) -> None:
        from fastembed import TextEmbedding

        self._model = TextEmbedding(self.name, cache_dir=str(cache_dir), local_files_only=not download)

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        v = np.array(list(self._model.embed(list(texts))), dtype=np.float32)
        return v / np.linalg.norm(v, axis=1, keepdims=True).clip(min=1e-9)


class HashEmbedder:
    """Deterministic bag-of-words hashing embedder (labelled fake) for tests - no model, no network."""

    name = "hash-fake"

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        out = np.zeros((len(texts), 256), dtype=np.float32)
        for i, t in enumerate(texts):
            for tok in tokenize(t):
                out[i, zlib.crc32(tok.encode()) % 256] += 1.0
        return out / np.linalg.norm(out, axis=1, keepdims=True).clip(min=1e-9)


# --------------------------------------------------------------------------- index + search


class ManualIndex:
    def __init__(self, chunks: list[Chunk], embeddings: np.ndarray | None, embedder: Embedder | None,
                 embedder_name: str | None = None, fingerprint: str | None = None) -> None:
        from rank_bm25 import BM25Okapi

        self.chunks = chunks
        self.bm25 = BM25Okapi([tokenize(c.title + " " + c.text) for c in chunks])
        self.embeddings = embeddings
        self.embedder = embedder
        self.embedder_name = embedder_name
        self.fingerprint = fingerprint

    @property
    def dense(self) -> bool:
        return self.embeddings is not None and self.embedder is not None

    @property
    def provenance(self) -> str:
        return f"manual_rag (bm25 + {self.embedder_name})" if self.dense else "manual_rag (bm25 only)"

    # -------------------------------------------------------------- persistence
    @classmethod
    def build(cls, sources: Path | Sequence[Path], embedder: Embedder | None) -> ManualIndex:
        dirs = [sources] if isinstance(sources, Path) else list(sources)
        chunks = [c for d in dirs for c in load_chunks(d)]
        emb = embedder.embed([c.title + "\n" + c.text for c in chunks]) if embedder else None
        return cls(chunks, emb, embedder, embedder.name if embedder else None, fingerprint(dirs))

    def save(self, index_dir: Path) -> None:
        index_dir.mkdir(parents=True, exist_ok=True)
        (index_dir / "chunks.json").write_text(json.dumps([asdict(c) for c in self.chunks], indent=1))
        if self.embeddings is not None:
            np.save(index_dir / "embeddings.npy", self.embeddings)
        (index_dir / "meta.json").write_text(json.dumps({"embedder": self.embedder_name, "chunks": len(self.chunks),
                                                         "fingerprint": self.fingerprint}))

    @staticmethod
    def stored_fingerprint(index_dir: Path) -> str | None:
        try:
            return json.loads((index_dir / "meta.json").read_text()).get("fingerprint")
        except (OSError, ValueError):
            return None

    @classmethod
    def load(cls, index_dir: Path, embedder: Embedder | None) -> ManualIndex:
        chunks = [Chunk(**c) for c in json.loads((index_dir / "chunks.json").read_text())]
        meta = json.loads((index_dir / "meta.json").read_text())
        emb_path = index_dir / "embeddings.npy"
        emb = np.load(emb_path) if emb_path.exists() else None
        if embedder is not None and meta.get("embedder") != embedder.name:
            embedder, emb = None, None  # never mix vector spaces
        return cls(chunks, emb if embedder else None, embedder, meta.get("embedder") if embedder else None,
                   meta.get("fingerprint"))

    # -------------------------------------------------------------- search
    def _weight(self, i: int, profile: RetrievalProfile | None) -> float:
        c = self.chunks[i]
        w = SYNTHETIC_WEIGHT if c.synthetic else 1.0
        return w * profile.weight(c.domain) if profile is not None else w

    def search(self, query: str, k: int = 5, profile: RetrievalProfile | None = None) -> dict[str, Any]:
        """Hybrid search. A `profile` (the specialist's) re-weights domains after fusion and may leave some
        out; exact fault-code hits still lead."""
        codes = set(FAULT_RE.findall(query.upper()))
        exact = [i for i, c in enumerate(self.chunks) if codes & set(FAULT_RE.findall(c.text))]
        scores = self.bm25.get_scores(tokenize(query))
        bm_rank = [i for i in np.argsort(-scores) if scores[i] > 0][:20]
        dense_rank: list[int] = []
        cos = None
        if self.dense:
            q = self.embedder.embed([query])[0]
            cos = self.embeddings @ q
            dense_rank = [i for i in np.argsort(-cos) if cos[i] >= MIN_COSINE][:20]
        fused: dict[int, float] = {}
        for rank_list in (bm_rank, dense_rank):
            for r, i in enumerate(rank_list):
                i = int(i)
                if profile is not None and not profile.allows(self.chunks[i].domain):
                    continue
                # weights act in rank space (effective rank = rank / weight): a preferred domain climbs a few
                # places, it never overrides relevance the way a multiplier on RRF scores would
                fused[i] = fused.get(i, 0.0) + 1.0 / (RRF_K + r / self._weight(i, profile) + 1)
        for i in exact:
            fused[i] = fused.get(i, 0.0) + 1.0  # exact fault-code hits always lead
        ranked = sorted(fused, key=lambda i: -fused[i])[:k]
        hits = []
        for i in ranked:
            c = self.chunks[i]
            hits.append({"chunk_id": c.chunk_id, "doc_id": c.doc_id, "title": c.title, "citation": c.citation,
                         "page": c.page, "section": c.section, "quote": c.text[:700], "score": round(fused[i], 4),
                         "match": "fault_code" if i in exact else "hybrid", "source": c.source,
                         "domain": c.domain, "synthetic": c.synthetic})
        out = {"query": query, "hits": hits, "found": bool(hits), "provenance": self.provenance}
        if profile is not None:
            out["profile"] = profile.name
        if any(h["synthetic"] for h in hits):
            out["note"] = ("Passages marked synthetic are demo knowledge written for this prototype, not an official "
                           "manual or procedure. Say so when you rely on them.")
        return out

    async def tool_search(self, query: str, profile: RetrievalProfile | None = None):
        import asyncio

        from copilot.agent.registry import ToolResult

        res = await asyncio.to_thread(self.search, query, 5, profile)
        if not res["found"]:
            return ToolResult(True, {"found": False, "note": "Not in the manuals I have. Say so; do not guess."},
                              res["provenance"], "not in the manuals")
        return ToolResult(True, res, res["provenance"], f"{len(res['hits'])} passages")
