"""Specialist-aware retrieval: one shared index, a weighting profile per specialist.

The hybrid BM25 + dense search in `manuals.ManualIndex` is the only retrieval engine. A profile only
re-weights (or leaves out) document domains after rank fusion, so a safety question leans on
regulations and the site manual while a trainee's question leans on training material. Domains:

    regulation   29 CFR text (verbatim, public domain)
    site_manual  the team's demo site manual (the simulator's own thresholds)
    training / safety / machine / maintenance   synthetic demo knowledge (backend/data/synthetic)

Adding a real machine manual later means dropping it in backend/data/manuals with a `domain`
frontmatter key; no profile or engine change is needed.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType


@dataclass(frozen=True)
class RetrievalProfile:
    name: str
    weights: Mapping[str, float] = field(default_factory=dict)
    #: domains this profile never retrieves (empty = all allowed)
    exclude: frozenset[str] = frozenset()

    def weight(self, domain: str) -> float:
        return self.weights.get(domain, 1.0)

    def allows(self, domain: str) -> bool:
        return domain not in self.exclude


def _p(name: str, **weights: float) -> RetrievalProfile:
    return RetrievalProfile(name, MappingProxyType(weights))


PROFILES: dict[str, RetrievalProfile] = {p.name: p for p in (
    _p("safety", safety=1.6, regulation=1.4, site_manual=1.4, machine=1.1, training=1.0, maintenance=0.7),
    _p("training", training=1.6, safety=1.4, machine=1.3, site_manual=1.2, regulation=1.0, maintenance=0.8),
    _p("operations", machine=1.6, site_manual=1.4, safety=1.3, training=1.1, regulation=1.0, maintenance=0.9),
    _p("maintenance", maintenance=1.6, site_manual=1.5, machine=1.2, safety=0.9, regulation=0.8, training=0.7),
    _p("planner", machine=1.3, safety=1.2, site_manual=1.1, regulation=1.0, training=0.8, maintenance=0.8),
    _p("coordination", machine=1.4, safety=1.3, site_manual=1.2, regulation=1.0, training=0.8, maintenance=0.8),
    _p("reporting", site_manual=1.2, regulation=1.1, maintenance=1.1, safety=1.0, machine=0.9, training=0.8),
    _p("general"),
)}


def profile_for(specialist: str | None, surface: str | None = None) -> RetrievalProfile:
    """The specialist's profile. A general question asked on the training surface is a trainee's."""
    if specialist in PROFILES and specialist != "general":
        return PROFILES[specialist]
    if surface == "training":
        return PROFILES["training"]
    return PROFILES["general"]
