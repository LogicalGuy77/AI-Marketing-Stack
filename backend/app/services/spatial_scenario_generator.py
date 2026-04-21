"""
Dynamic spatial scenario generator.

Reads entities from a ZEP knowledge graph and uses an LLM to produce a
fully self-contained scenario dict compatible with spatial_runner.py.
"""

from __future__ import annotations

import math
import random
import uuid
from typing import Any, Dict, List, Optional

from ..utils.llm_client import LLMClient
from ..utils.logger import get_logger
from .zep_entity_reader import ZepEntityReader

logger = get_logger("mirofish.spatial_scenario_generator")

BLUEPRINT_VOCABULARY = [
    "government", "university", "hospital", "market", "military", "media",
    "residential", "industrial", "park", "port", "border", "religious",
    "slum", "tech_campus", "airport",
]

ZONE_TO_AGENT_ARCHETYPE: Dict[str, str] = {
    "government": "official",
    "university": "student",
    "market": "vendor",
    "industrial": "worker",
    "residential": "citizen",
    "park": "visitor",
    "hospital": "citizen",
    "military": "official",
    "media": "journalist",
    "port": "worker",
    "border": "visitor",
    "religious": "citizen",
    "slum": "citizen",
    "tech_campus": "student",
    "airport": "visitor",
}

DENSITY_COUNTS = {"low": 2, "medium": 4, "high": 6}

ZONE_COLORS: Dict[str, str] = {
    "government": "#3b82f6",
    "university": "#a855f7",
    "market": "#f59e0b",
    "industrial": "#94a3b8",
    "residential": "#10b981",
    "park": "#84cc16",
    "airport": "#06b6d4",
    "hospital": "#f0f9ff",
    "military": "#4b5320",
    "media": "#f97316",
    "port": "#0891b2",
    "border": "#ef4444",
    "religious": "#fbbf24",
    "slum": "#78716c",
    "tech_campus": "#8b5cf6",
}

GRID_W = 60
GRID_H = 40
ROAD_MARGIN = 2


def _pack_bboxes(n: int) -> List[List[float]]:
    """Pack n zones into a 60×40 grid using a deterministic grid layout.
    Returns list of [x0, y0, x1, y1] for each zone."""
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    cell_w = (GRID_W - ROAD_MARGIN * (cols + 1)) / cols
    cell_h = (GRID_H - ROAD_MARGIN * (rows + 1)) / rows
    bboxes = []
    for i in range(n):
        col = i % cols
        row = i // cols
        x0 = ROAD_MARGIN + col * (cell_w + ROAD_MARGIN)
        y0 = ROAD_MARGIN + row * (cell_h + ROAD_MARGIN)
        x1 = x0 + cell_w
        y1 = y0 + cell_h
        bboxes.append([round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)])
    return bboxes


class SpatialScenarioGenerator:
    def __init__(self, api_key: Optional[str] = None):
        self._client = LLMClient()
        self._reader = ZepEntityReader(api_key=api_key)

    def generate(self, graph_id: str, requirement: str = "") -> Dict[str, Any]:
        """Generate a complete scenario dict from a ZEP graph."""
        # Read entities
        try:
            filtered = self._reader.filter_defined_entities(graph_id, enrich_with_edges=True)
            entities = filtered.entities
        except Exception as e:
            logger.warning(f"ZEP entity read failed for graph {graph_id}: {e}")
            entities = []

        entity_digest = self._build_entity_digest(entities)
        skeleton = self._llm_generate_skeleton(entity_digest, requirement)
        zones = self._validate_zones(skeleton.get("zones") or [])
        bboxes = _pack_bboxes(len(zones))
        for i, z in enumerate(zones):
            z["bbox"] = bboxes[i]
            if not z.get("color"):
                z["color"] = ZONE_COLORS.get(z.get("archetype", ""), "#94a3b8")

        agents = self._build_agents(zones, entities, skeleton)
        scenario_id = f"gen_{uuid.uuid4().hex[:8]}"

        return {
            "id": scenario_id,
            "title": skeleton.get("title", "Generated Scenario"),
            "seed": skeleton.get("seed", "A significant event has unfolded."),
            "description": skeleton.get("description", ""),
            "origin_zones": skeleton.get("origin_zones") or ([zones[0]["name"]] if zones else []),
            "narratives": skeleton.get("narratives") or {"narrative_a": "Narrative A", "narrative_b": "Narrative B"},
            "zone_to_narrative": skeleton.get("zone_to_narrative") or {},
            "journalist_count": int(skeleton.get("journalist_count") or 4),
            "zones": zones,
            "agents": agents,
            "event_schedule": skeleton.get("event_schedule") or [],
            "total_ticks": 50,
            "generated_from_graph": graph_id,
        }

    def _build_entity_digest(self, entities) -> str:
        lines = []
        for e in entities[:80]:
            label = e.get_entity_type() or "Entity"
            summary = (e.summary or "")[:120]
            lines.append(f"- [{label}] {e.name}: {summary}")
        return "\n".join(lines)

    def _llm_generate_skeleton(self, entity_digest: str, requirement: str) -> Dict[str, Any]:
        vocab_str = ", ".join(BLUEPRINT_VOCABULARY)
        extra = f"\nAdditional requirement: {requirement}" if requirement else ""
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a world-builder for a city-level information-propagation simulation. "
                    "Given a knowledge graph digest, generate a scenario. "
                    "Return ONLY valid JSON with these keys:\n"
                    "  title (string), seed (1-2 sentence triggering event), description (1 sentence),\n"
                    "  narratives (object: 2-3 slug→text pairs),\n"
                    "  zones (array of objects with name, archetype, population_density [low/medium/high]),\n"
                    "  origin_zones (array of zone names, 1-2),\n"
                    "  zone_to_narrative (object: zone_name→narrative_slug),\n"
                    "  event_schedule (array of 3 objects: tick[int], kind[string], zone[string|null], "
                    "prompt_hint[string], stance_nudge[object: slug→float]),\n"
                    "  journalist_count (int 2-6).\n"
                    f"Zone archetype MUST be one of: {vocab_str}.\n"
                    "Use 4-8 zones. Make it geopolitically grounded and dramatic. No prose outside JSON."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Knowledge graph entities:\n{entity_digest or '(no entities available)'}\n"
                    f"{extra}\n\nGenerate the scenario JSON:"
                ),
            },
        ]
        try:
            resp = self._client.chat_json(messages, temperature=0.8, max_tokens=2500)
            if isinstance(resp, dict) and resp.get("title"):
                return resp
        except Exception as e:
            logger.warning(f"Scenario skeleton LLM call failed: {e}")

        # Retry at lower temperature
        try:
            resp = self._client.chat_json(messages, temperature=0.3, max_tokens=2500)
            if isinstance(resp, dict) and resp.get("title"):
                return resp
        except Exception as e:
            logger.warning(f"Scenario skeleton LLM retry failed: {e}")

        # Hardcoded fallback
        return {
            "title": "Crisis Scenario",
            "seed": "A major geopolitical crisis has erupted, triggering competing narratives across the city.",
            "description": "Dynamically generated scenario with fallback zones.",
            "narratives": {
                "official_line": "The official government position urging calm and cooperation.",
                "public_dissent": "A grassroots counter-narrative challenging the official account.",
            },
            "zones": [
                {"name": "Government District", "archetype": "government", "population_density": "high"},
                {"name": "University Quarter", "archetype": "university", "population_density": "medium"},
                {"name": "Central Market", "archetype": "market", "population_density": "high"},
                {"name": "Industrial Zone", "archetype": "industrial", "population_density": "medium"},
                {"name": "Residential Area", "archetype": "residential", "population_density": "high"},
                {"name": "City Park", "archetype": "park", "population_density": "low"},
            ],
            "origin_zones": ["Government District", "University Quarter"],
            "zone_to_narrative": {
                "Government District": "official_line",
                "University Quarter": "public_dissent",
            },
            "event_schedule": [
                {"tick": 12, "kind": "leak", "zone": "Government District",
                 "prompt_hint": "A leaked document contradicts the official narrative.",
                 "stance_nudge": {"official_line": -0.15, "public_dissent": 0.10}},
                {"tick": 25, "kind": "clarification", "zone": None,
                 "prompt_hint": "A public statement attempts to reinforce the official position.",
                 "stance_nudge": {"official_line": 0.18, "public_dissent": -0.08}},
                {"tick": 38, "kind": "counter_narrative", "zone": "Central Market",
                 "prompt_hint": "Economic impacts fuel grassroots opposition in the market.",
                 "stance_nudge": {"official_line": -0.10, "public_dissent": 0.12}},
            ],
            "journalist_count": 4,
        }

    def _validate_zones(self, zones_raw: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out = []
        for z in zones_raw:
            archetype = str(z.get("archetype", "")).lower().replace(" ", "_")
            if archetype not in BLUEPRINT_VOCABULARY:
                archetype = "residential"
            out.append({
                "name": str(z.get("name", f"Zone {len(out)+1}")),
                "archetype": archetype,
                "population_density": z.get("population_density", "medium"),
            })
        return out or [{"name": "Central District", "archetype": "government", "population_density": "high"}]

    def _build_agents(self, zones: List[Dict], entities, skeleton: Dict) -> List[Dict[str, Any]]:
        entity_names = [e.name for e in entities] if entities else []
        agents = []
        idx = 0
        for z in zones:
            density = z.get("population_density", "medium")
            count = DENSITY_COUNTS.get(density, 4)
            archetype = ZONE_TO_AGENT_ARCHETYPE.get(z.get("archetype", ""), "citizen")
            for i in range(count):
                # Use entity names where available
                if entity_names:
                    name = entity_names.pop(0)
                else:
                    name = f"{archetype.title()} {idx}"
                agents.append({
                    "id": f"{archetype[:3]}_{idx:02d}",
                    "name": name,
                    "zone": z["name"],
                    "archetype": archetype,
                })
                idx += 1
        return agents
