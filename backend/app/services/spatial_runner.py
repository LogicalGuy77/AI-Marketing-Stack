"""
Spatial simulation engine for MiroFish.

Adds an information-geography layer on top of the existing text-only swarm:
agents get (x, y) coordinates on a 2D city grid, move each tick, and can only
exchange beliefs with other agents within a proximity radius. Two hardcoded
scenarios demonstrate how spatial isolation changes which narratives dominate.

Completely independent of OASIS / graph-build / report pipelines. State lives
in a module-level dict for the lifetime of the Flask process.
"""

from __future__ import annotations

import json
import math
import os
import random
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..utils.llm_client import LLMClient
from ..utils.logger import get_logger

logger = get_logger("mirofish.spatial")


GRID_W = 60
GRID_H = 40
PROXIMITY_R = 6.0
TOTAL_TICKS = 50
POLL_SNAPSHOT_LIMIT = 1000

OUTPUTS_DIR = Path(__file__).resolve().parents[3] / "outputs" / "spatial"


ZONES: List[Dict[str, Any]] = [
    {"name": "Government", "bbox": (4, 22, 20, 36),  "color": "#3b82f6", "archetype": "official"},
    {"name": "University", "bbox": (40, 22, 56, 36), "color": "#8b5cf6", "archetype": "student"},
    {"name": "Market",     "bbox": (22, 18, 38, 30), "color": "#f59e0b", "archetype": "vendor"},
    {"name": "Industrial", "bbox": (4, 4, 22, 16),   "color": "#6b7280", "archetype": "worker"},
    {"name": "Residential","bbox": (24, 4, 42, 14),  "color": "#10b981", "archetype": "citizen"},
    {"name": "Park",       "bbox": (44, 4, 56, 16),  "color": "#84cc16", "archetype": "visitor"},
]
ZONES_BY_NAME = {z["name"]: z for z in ZONES}


SCENARIOS: Dict[str, Dict[str, Any]] = {
    "sides_with_us": {
        "id": "sides_with_us",
        "title": "India Sides with USA",
        "seed": (
            "India deepens the QUAD alliance, signs a bilateral defense pact "
            "with the US, and expels Iranian diplomatic staff from New Delhi."
        ),
        "origin_zones": ["Government", "University"],
        "narratives": {
            "official_alliance": (
                "Official framing: a necessary strategic alignment that "
                "strengthens deterrence and unlocks defense-tech transfers."
            ),
            "student_protest": (
                "Protest framing: a betrayal of non-alignment; students warn "
                "of being dragged into someone else's war and rising oil costs."
            ),
        },
        "zone_to_narrative": {
            "Government": "official_alliance",
            "University": "student_protest",
        },
        "journalist_count": 4,
        "description": (
            "Two competing narratives originate simultaneously in Government "
            "and University. Journalists carry different stories; the Market "
            "is the first zone to hear both, producing confused thoughts."
        ),
        # Hybrid events: scheduled tick+kind+hint, LLM fills text at sim start
        "event_schedule": [
            {"tick": 12, "kind": "leak", "zone": "Government",
             "prompt_hint": "A leaked internal memo contradicts the official framing; hint at elite dissent.",
             "stance_nudge": {"official_alliance": -0.15, "student_protest": 0.10}},
            {"tick": 25, "kind": "clarification", "zone": None,
             "prompt_hint": "Government issues a public clarification reinforcing the alliance narrative.",
             "stance_nudge": {"official_alliance": 0.18, "student_protest": -0.08}},
            {"tick": 38, "kind": "counter_narrative", "zone": "Market",
             "prompt_hint": "Oil prices spike on futures markets; vendors feel immediate pain.",
             "stance_nudge": {"official_alliance": -0.10, "student_protest": 0.12}},
        ],
    },
}


# Default persona shape by archetype — used when LLM persona generation fails
# or for agents that weren't covered in the batch response.
ARCHETYPE_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "official":   {"influence": 2.3, "susceptibility": 0.7, "speaking_style": "measured and official",
                   "ideology": "realist, state-first", "values": ["order", "deterrence", "continuity"]},
    "student":    {"influence": 1.2, "susceptibility": 1.4, "speaking_style": "impassioned and idealistic",
                   "ideology": "non-aligned, anti-war", "values": ["autonomy", "solidarity", "peace"]},
    "vendor":     {"influence": 1.4, "susceptibility": 1.0, "speaking_style": "pragmatic and direct",
                   "ideology": "business-first", "values": ["prices", "family", "stability"]},
    "worker":     {"influence": 1.1, "susceptibility": 0.9, "speaking_style": "skeptical and terse",
                   "ideology": "labour-pragmatist", "values": ["wages", "safety", "children"]},
    "citizen":    {"influence": 1.0, "susceptibility": 1.1, "speaking_style": "earnest and searching",
                   "ideology": "middle-ground", "values": ["family", "routine", "hope"]},
    "visitor":    {"influence": 1.0, "susceptibility": 1.0, "speaking_style": "curious and detached",
                   "ideology": "observer", "values": ["experience", "freedom", "calm"]},
    "journalist": {"influence": 2.7, "susceptibility": 0.9, "speaking_style": "inquisitive and punchy",
                   "ideology": "independent, truth-seeking", "values": ["accuracy", "access", "impact"]},
}


INFORMED_THRESHOLD = 0.15  # |stance| above which an agent counts as "informed"


@dataclass
class Agent:
    id: str
    name: str
    zone: str
    archetype: str
    x: float
    y: float
    vx: float = 0.0
    vy: float = 0.0
    # Rich state (Phase 1)
    persona: Dict[str, Any] = field(default_factory=dict)
    stances: Dict[str, float] = field(default_factory=dict)   # narrative_id -> [-1, 1]
    exposure: Dict[str, int] = field(default_factory=dict)    # narrative_id -> times heard
    thought_log: List[Dict[str, Any]] = field(default_factory=list)  # cap 5
    last_interaction_tick: int = -1
    migration_target: Optional[str] = None
    # Derived / legacy
    last_thought: Optional[str] = None
    learned_at_tick: Optional[int] = None

    def dominant_narrative(self) -> Optional[str]:
        if not self.stances:
            return None
        best = max(self.stances.items(), key=lambda kv: abs(kv[1]))
        return best[0] if abs(best[1]) >= INFORMED_THRESHOLD else None

    def intensity(self) -> float:
        if not self.stances:
            return 0.0
        return max(abs(v) for v in self.stances.values())

    def is_informed(self) -> bool:
        return self.intensity() >= INFORMED_THRESHOLD

    def record_thought(self, tick: int, text: str, trigger: str) -> None:
        self.last_thought = text
        self.thought_log.append({"tick": tick, "text": text, "trigger": trigger})
        if len(self.thought_log) > 5:
            self.thought_log.pop(0)

    def as_dict(self, flipped_this_tick: bool = False) -> Dict[str, Any]:
        d = asdict(self)
        # Legacy fields consumed by frontend beats + scene color rules
        d["knows"] = self.is_informed()
        d["belief"] = self.dominant_narrative()
        # New derived scalars for UI (color lerp, halo intensity)
        d["dominant_stance"] = self.dominant_narrative()
        d["intensity"] = self.intensity()
        d["flipped_this_tick"] = flipped_this_tick
        return d


SPATIAL_STATE: Dict[str, Dict[str, Any]] = {}
_STATE_LOCK = threading.Lock()


def _rand_in_zone(zone_name: str) -> Tuple[float, float]:
    x0, y0, x1, y1 = ZONES_BY_NAME[zone_name]["bbox"]
    return random.uniform(x0 + 0.5, x1 - 0.5), random.uniform(y0 + 0.5, y1 - 0.5)


def _zone_center(zone_name: str) -> Tuple[float, float]:
    x0, y0, x1, y1 = ZONES_BY_NAME[zone_name]["bbox"]
    return (x0 + x1) / 2.0, (y0 + y1) / 2.0


def spawn_agents(scenario: Dict[str, Any]) -> List[Agent]:
    """Create the initial 24-agent population for a scenario."""
    plan = [
        ("Government",  4, "official",  ["PMO Aide", "MEA Officer", "NSA Analyst", "Cabinet Secretary"]),
        ("University",  4, "student",   ["PhD Scholar", "JNU Student", "Debate Captain", "Journalism Major"]),
        ("Market",      4, "vendor",    ["Spice Vendor", "Forex Dealer", "Shop Owner", "Tea Seller"]),
        ("Industrial",  3, "worker",    ["Plant Operator", "Logistics Hand", "Shift Foreman"]),
        ("Residential", 3, "citizen",   ["Homemaker", "Retired Teacher", "IT Consultant"]),
        ("Park",        2, "visitor",   ["Jogger", "Street Photographer"]),
    ]
    agents: List[Agent] = []
    idx = 0
    for zone_name, count, archetype, names in plan:
        for i in range(count):
            x, y = _rand_in_zone(zone_name)
            agents.append(Agent(
                id=f"{archetype[:3]}_{idx:02d}",
                name=names[i] if i < len(names) else f"{archetype.title()} {i}",
                zone=zone_name,
                archetype=archetype,
                x=x, y=y,
            ))
            idx += 1

    for j in range(scenario["journalist_count"]):
        zone = random.choice(["Market", "Government", "University"])
        x, y = _rand_in_zone(zone)
        agents.append(Agent(
            id=f"jnl_{j:02d}",
            name=f"Reporter {chr(ord('A') + j)}",
            zone=zone,
            archetype="journalist",
            x=x, y=y,
        ))

    origin_zones = scenario["origin_zones"]
    narratives = list(scenario["narratives"].keys())
    zone_to_narrative = scenario.get("zone_to_narrative", {})
    # Initialize every agent's stance dict with 0.0 for each narrative
    for agent in agents:
        for n in narratives:
            agent.stances[n] = 0.0
            agent.exposure[n] = 0
    # Seed origin-zone agents with a strong stance on "their" narrative
    for agent in agents:
        if agent.zone in origin_zones:
            if agent.zone in zone_to_narrative:
                seed_narr = zone_to_narrative[agent.zone]
            elif len(narratives) == 1:
                seed_narr = narratives[0]
            elif agent.zone == "Government":
                seed_narr = narratives[0]
            else:
                seed_narr = narratives[1] if len(narratives) > 1 else narratives[0]
            agent.stances[seed_narr] = 0.8
            agent.learned_at_tick = 0
    return agents


def _default_persona(agent: Agent) -> Dict[str, Any]:
    """Minimal fallback persona when the LLM batch didn't cover an agent."""
    base = ARCHETYPE_DEFAULTS.get(agent.archetype, {
        "influence": 1.0, "susceptibility": 1.0, "speaking_style": "plain",
        "ideology": "undecided", "values": ["family", "work", "hope"],
    })
    return {
        "bio": f"{agent.name}, a {agent.archetype} in the {agent.zone} District.",
        "ideology": base["ideology"],
        "values": list(base["values"]),
        "demographics": {
            "age": random.randint(22, 62),
            "gender": random.choice(["male", "female", "nonbinary"]),
            "profession": agent.archetype,
            "mbti": random.choice(["ISTJ", "INFP", "ENTP", "ENFJ", "INTJ", "ESFP", "ESTJ"]),
        },
        "speaking_style": base["speaking_style"],
        "influence": float(base["influence"]),
        "susceptibility": float(base["susceptibility"]),
    }


def _generate_personas(client: LLMClient, agents: List[Agent], scenario: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """One LLM call → persona per agent. Returns {agent_id: persona_dict}. Falls back to defaults on failure."""
    narratives_text = "\n".join(f"- {k}: {v}" for k, v in scenario["narratives"].items())
    agent_lines = [
        f'{{"id":"{a.id}","name":"{a.name}","archetype":"{a.archetype}","zone":"{a.zone}"}}'
        for a in agents
    ]
    agents_json = "[\n  " + ",\n  ".join(agent_lines) + "\n]"

    messages = [
        {
            "role": "system",
            "content": (
                "You generate realistic persona descriptors for agents in a city simulation about "
                "information propagation. Return ONLY a JSON object. Top-level key 'personas' maps "
                "agent id -> persona object. Each persona has keys: "
                "bio (1 sentence about this specific person, their job, a memorable trait), "
                "ideology (1 sentence describing their political/social leanings), "
                "values (array of exactly 3 short strings), "
                "demographics (object with age:int, gender:string, profession:string, mbti:string), "
                "speaking_style (one short phrase, e.g. 'measured and dry'), "
                "influence (float 1.0-3.0 — how persuasive they are), "
                "susceptibility (float 0.3-1.5 — how open to other views). "
                "Differentiate realistically: officials are high-influence low-susceptibility; "
                "students high-susceptibility impassioned; journalists very-high-influence mid-susceptibility; "
                "vendors pragmatic mid-influence; workers skeptical low-susceptibility; "
                "residents mixed; park visitors easygoing. Make each bio distinctive. No prose outside JSON."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Scenario: {scenario['title']}\n"
                f"Seed event: {scenario['seed']}\n\n"
                f"Competing narratives:\n{narratives_text}\n\n"
                f"Agents (generate a persona for each by id):\n{agents_json}\n\n"
                "Return JSON: {\"personas\": {\"<agent_id>\": {persona_object}, ...}}"
            ),
        },
    ]

    try:
        resp = client.chat_json(messages, temperature=0.8, max_tokens=4000)
        personas = resp.get("personas", {}) if isinstance(resp, dict) else {}
        if not isinstance(personas, dict):
            personas = {}
    except Exception as e:
        logger.warning(f"Persona batch generation failed: {e}")
        personas = {}

    # Validate + fill missing
    out: Dict[str, Dict[str, Any]] = {}
    for a in agents:
        p = personas.get(a.id)
        if not isinstance(p, dict):
            out[a.id] = _default_persona(a)
            continue
        # Merge: LLM-provided fields override defaults; clamp numeric ranges
        d = _default_persona(a)
        for key in ("bio", "ideology", "speaking_style"):
            if isinstance(p.get(key), str) and p[key].strip():
                d[key] = p[key].strip()
        if isinstance(p.get("values"), list) and p["values"]:
            d["values"] = [str(v) for v in p["values"][:4]]
        if isinstance(p.get("demographics"), dict):
            demo = dict(d["demographics"])
            demo.update({k: v for k, v in p["demographics"].items() if v is not None})
            d["demographics"] = demo
        try:
            d["influence"] = max(1.0, min(3.0, float(p.get("influence", d["influence"]))))
            d["susceptibility"] = max(0.3, min(1.5, float(p.get("susceptibility", d["susceptibility"]))))
        except (TypeError, ValueError):
            pass
        out[a.id] = d
    return out


def _clamp_in_zone(agent: Agent) -> None:
    x0, y0, x1, y1 = ZONES_BY_NAME[agent.zone]["bbox"]
    agent.x = max(x0 + 0.3, min(x1 - 0.3, agent.x))
    agent.y = max(y0 + 0.3, min(y1 - 0.3, agent.y))


def _move_agent(agent: Agent, tick: int) -> None:
    if agent.archetype == "journalist":
        if tick % 12 == 0 or agent.vx == agent.vy == 0:
            target_zone = random.choice([z["name"] for z in ZONES if z["name"] != agent.zone])
            tx, ty = _zone_center(target_zone)
            dx, dy = tx - agent.x, ty - agent.y
            mag = (dx * dx + dy * dy) ** 0.5 or 1.0
            agent.vx, agent.vy = dx / mag * 0.9, dy / mag * 0.9
            agent.zone = target_zone
        agent.x += agent.vx + random.uniform(-0.25, 0.25)
        agent.y += agent.vy + random.uniform(-0.25, 0.25)
        agent.x = max(1.0, min(GRID_W - 1.0, agent.x))
        agent.y = max(1.0, min(GRID_H - 1.0, agent.y))
        return

    # Phase 5: non-journalist migration
    if agent.migration_target and agent.migration_target != agent.zone:
        tx, ty = _zone_center(agent.migration_target)
        dx, dy = tx - agent.x, ty - agent.y
        dist = (dx * dx + dy * dy) ** 0.5 or 1.0
        # Steer with some noise
        agent.vx = 0.85 * (dx / dist * 0.8) + random.uniform(-0.15, 0.15)
        agent.vy = 0.85 * (dy / dist * 0.8) + random.uniform(-0.15, 0.15)
        agent.x += agent.vx
        agent.y += agent.vy
        agent.x = max(1.0, min(GRID_W - 1.0, agent.x))
        agent.y = max(1.0, min(GRID_H - 1.0, agent.y))
        # Update zone if we've entered target bbox
        x0, y0, x1, y1 = ZONES_BY_NAME[agent.migration_target]["bbox"]
        if x0 <= agent.x <= x1 and y0 <= agent.y <= y1:
            agent.zone = agent.migration_target
        return

    # Default: brownian motion within zone
    agent.vx = 0.7 * agent.vx + random.uniform(-0.4, 0.4)
    agent.vy = 0.7 * agent.vy + random.uniform(-0.4, 0.4)
    agent.x += agent.vx
    agent.y += agent.vy
    _clamp_in_zone(agent)


def _propagate(agents: List[Agent], scenario: Dict[str, Any], tick: int) -> Tuple[List[str], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Continuous stance diffusion.

    For each pair within PROXIMITY_R, each narrative's stance diffuses from
    source to target weighted by: src.influence * tanh(src.stance) * distance_decay
    * target.susceptibility / (1 + target.exposure). Opposing stances diffuse at
    half strength (cognitive friction). Stances clipped to [-1, 1].

    Returns (flipped_ids, transfer_events, candidate_events) — candidate_events
    lists strong encounters that the dialog pool may pick up (Phase 2).
    """
    narratives = list(scenario["narratives"].keys())
    transfers: List[Dict[str, Any]] = []
    candidate_dialogs: List[Dict[str, Any]] = []

    was_informed = {a.id: a.is_informed() for a in agents}
    prior_stances = {a.id: dict(a.stances) for a in agents}

    r2 = PROXIMITY_R * PROXIMITY_R
    for i in range(len(agents)):
        a = agents[i]
        for j in range(i + 1, len(agents)):
            b = agents[j]
            dx, dy = a.x - b.x, a.y - b.y
            d2 = dx * dx + dy * dy
            if d2 > r2:
                continue
            dist = math.sqrt(max(d2, 0.0001))
            decay = math.exp(-dist / PROXIMITY_R)

            a_inf = float(a.persona.get("influence", 1.0))
            a_sus = float(a.persona.get("susceptibility", 1.0))
            b_inf = float(b.persona.get("influence", 1.0))
            b_sus = float(b.persona.get("susceptibility", 1.0))

            max_shift = 0.0
            dominant_n = None
            for n in narratives:
                sa = a.stances.get(n, 0.0)
                sb = b.stances.get(n, 0.0)
                # a -> b
                if abs(sa) > 0.05:
                    damp = 0.5 if sa * sb < 0 else 1.0
                    ex_discount = 1.0 / (1.0 + 0.3 * b.exposure.get(n, 0))
                    delta_b = a_inf * math.tanh(sa) * 0.22 * decay * b_sus * damp * ex_discount
                    b.stances[n] = max(-1.0, min(1.0, sb + delta_b))
                    b.exposure[n] = b.exposure.get(n, 0) + 1
                    if abs(delta_b) > abs(max_shift):
                        max_shift = delta_b
                        dominant_n = n
                # b -> a
                if abs(sb) > 0.05:
                    damp = 0.5 if sa * sb < 0 else 1.0
                    ex_discount = 1.0 / (1.0 + 0.3 * a.exposure.get(n, 0))
                    delta_a = b_inf * math.tanh(sb) * 0.22 * decay * a_sus * damp * ex_discount
                    a.stances[n] = max(-1.0, min(1.0, sa + delta_a))
                    a.exposure[n] = a.exposure.get(n, 0) + 1
                    if abs(delta_a) > abs(max_shift):
                        max_shift = delta_a
                        dominant_n = n

            a.last_interaction_tick = tick
            b.last_interaction_tick = tick

            # Only record meaningful transfers (avoid noise from tiny diffusions)
            if dominant_n is not None and abs(max_shift) > 0.01:
                # Source of the shift: whoever had the stronger stance on dominant_n
                sa_d = prior_stances[a.id].get(dominant_n, 0.0)
                sb_d = prior_stances[b.id].get(dominant_n, 0.0)
                if abs(sa_d) >= abs(sb_d):
                    src, dst = a, b
                else:
                    src, dst = b, a
                transfers.append({
                    "from": src.id,
                    "to": dst.id,
                    "belief": dominant_n,
                })
                # Flag strong encounters for potential LLM dialog escalation
                if (abs(max_shift) > 0.06 and
                    (src.persona.get("influence", 1.0) >= 2.0 or
                     src.archetype == "journalist" or
                     dst.archetype == "journalist")):
                    candidate_dialogs.append({
                        "a_id": a.id,
                        "b_id": b.id,
                        "narrative": dominant_n,
                        "prior_a": prior_stances[a.id].get(dominant_n, 0.0),
                        "prior_b": prior_stances[b.id].get(dominant_n, 0.0),
                        "delta": max_shift,
                        "x": (a.x + b.x) / 2,
                        "y": (a.y + b.y) / 2,
                    })

    # Newly-informed agents = those whose is_informed() flipped this tick
    flipped: List[str] = []
    for a in agents:
        if not was_informed[a.id] and a.is_informed():
            flipped.append(a.id)
            if a.learned_at_tick is None:
                a.learned_at_tick = tick

    return flipped, transfers, candidate_dialogs


def _stance_summary(agent: Agent, scenario: Dict[str, Any]) -> str:
    """Human-readable stance line for prompt context."""
    if not agent.stances:
        return "no formed opinion yet"
    parts = []
    for n, v in sorted(agent.stances.items(), key=lambda kv: -abs(kv[1])):
        if abs(v) < 0.08:
            continue
        label = "strongly agrees with" if v > 0.5 else ("leans toward" if v > 0 else
                ("leans against" if v > -0.5 else "strongly opposes"))
        narr_title = n.replace("_", " ")
        parts.append(f"{label} '{narr_title}' ({v:+.2f})")
    return "; ".join(parts) if parts else "neutral"


def _thought_prompt(agent: Agent, scenario: Dict[str, Any], trigger: str = "flip") -> List[Dict[str, str]]:
    persona = agent.persona or {}
    bio = persona.get("bio", f"{agent.name}, {agent.archetype}")
    ideology = persona.get("ideology", "")
    speaking = persona.get("speaking_style", "plain")
    stance_line = _stance_summary(agent, scenario)
    last_thought = agent.last_thought or ""
    return [
        {
            "role": "system",
            "content": (
                "You voice the inner thought of one specific person reacting to breaking news. "
                "Return ONE sentence (max 22 words). First person. Specific to their role, zone, "
                "persona and current opinion balance. Match their speaking style. "
                "No hashtags. No quotes. No em-dashes."
            ),
        },
        {
            "role": "user",
            "content": (
                f"You are {bio}\n"
                f"Ideology: {ideology}\n"
                f"Speaking style: {speaking}\n"
                f"You are in {agent.zone} District.\n"
                f"News event: {scenario['seed']}\n"
                f"Your current opinion balance: {stance_line}\n"
                + (f"Your previous thought was: \"{last_thought}\"\n" if last_thought else "")
                + f"Trigger for this thought: {trigger}\n"
                "Respond with one inner-thought sentence:"
            ),
        },
    ]


def _generate_thought_safe(client: LLMClient, agent: Agent, scenario: Dict[str, Any], trigger: str = "flip") -> str:
    try:
        return client.chat(
            _thought_prompt(agent, scenario, trigger),
            temperature=0.88,
            max_tokens=70,
        ).strip().strip('"').strip("'")
    except Exception as e:
        logger.warning(f"Thought gen failed for {agent.id}: {e}")
        return "…"


def _snapshot(
    tick: int,
    agents: List[Agent],
    flipped: List[str],
    new_thoughts: List[Dict[str, Any]],
    transfers: List[Dict[str, Any]],
    dialogs: Optional[List[Dict[str, Any]]] = None,
    events: Optional[List[Dict[str, Any]]] = None,
    dispatches: Optional[List[Dict[str, Any]]] = None,
    migrations: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    flipped_set = set(flipped)
    return {
        "tick": tick,
        "agents": [a.as_dict(flipped_this_tick=(a.id in flipped_set)) for a in agents],
        "new_thoughts": new_thoughts,
        "transfers": transfers,
        "dialogs": dialogs or [],
        "events": events or [],
        "dispatches": dispatches or [],
        "migrations": migrations or [],
    }


def _prefill_event_texts(client: LLMClient, scenario: Dict[str, Any]) -> List[Dict[str, Any]]:
    """One LLM batch at sim start: fill `text` for every scheduled event using its prompt_hint."""
    schedule = scenario.get("event_schedule", []) or []
    if not schedule:
        return []
    hints = []
    for i, ev in enumerate(schedule):
        zone = ev.get("zone") or "citywide"
        hints.append(f"{i}) tick {ev['tick']} — kind: {ev['kind']} — zone: {zone} — hint: {ev.get('prompt_hint','')}")
    try:
        resp = client.chat_json(
            [
                {
                    "role": "system",
                    "content": (
                        "You write brief news-ticker lines for events unfolding during a city "
                        "simulation. Return ONLY JSON: {\"texts\": [\"line 0\", \"line 1\", ...]}. "
                        "Each line ≤ 18 words, present tense, concrete, NO hashtags, NO quotes."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Scenario: {scenario['title']}\nSeed: {scenario['seed']}\n\n"
                        "Write one line per event in the order below:\n" + "\n".join(hints)
                    ),
                },
            ],
            temperature=0.75,
            max_tokens=600,
        )
        texts = resp.get("texts", []) if isinstance(resp, dict) else []
    except Exception as e:
        logger.warning(f"Event text prefill failed: {e}")
        texts = []

    filled = []
    for i, ev in enumerate(schedule):
        text = texts[i] if i < len(texts) and isinstance(texts[i], str) and texts[i].strip() else ev.get("prompt_hint", ev["kind"])
        filled.append({**ev, "text": text.strip().strip('"')})
    return filled


def _generate_dispatch(client: LLMClient, journalist: Agent, scenario: Dict[str, Any]) -> str:
    """LLM: 2-sentence press dispatch by a journalist, biased by their dominant stance."""
    stance_line = _stance_summary(journalist, scenario)
    try:
        return client.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "You write a 2-sentence press dispatch in a terse wire-service style. "
                        "Third person. Present tense. No hashtags. No quotes."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Journalist: {journalist.name} ({journalist.persona.get('speaking_style','')}).\n"
                        f"Current opinion balance: {stance_line}\n"
                        f"Scenario: {scenario['title']}\n"
                        f"Seed: {scenario['seed']}\n"
                        "Write a 2-sentence dispatch reflecting what this reporter has been observing:"
                    ),
                },
            ],
            temperature=0.8,
            max_tokens=120,
        ).strip().strip('"')
    except Exception as e:
        logger.warning(f"Dispatch gen failed for {journalist.id}: {e}")
        return "Dispatch unavailable."


def _run_dialog(
    client: LLMClient,
    scenario: Dict[str, Any],
    a_snapshot: Dict[str, Any],
    b_snapshot: Dict[str, Any],
    narrative: str,
) -> Dict[str, Any]:
    """LLM-generated dialog between two agents. Returns {summary, shift_a, shift_b}."""
    narr_title = narrative.replace("_", " ")
    narr_text = scenario["narratives"].get(narrative, "")
    try:
        resp = client.chat_json(
            [
                {
                    "role": "system",
                    "content": (
                        "You simulate a short in-person exchange between two city inhabitants. "
                        "Return ONLY JSON: {\"summary\": \"<≤22-word third-person summary of what was said>\", "
                        "\"shift_a\": <float in [-0.2, 0.2]>, \"shift_b\": <float in [-0.2, 0.2]>}. "
                        "The shifts describe how each person's stance on the given narrative changed "
                        "(positive = moved toward it, negative = away). Realistic, not dramatic."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Scenario: {scenario['title']}\n"
                        f"Narrative in question: '{narr_title}' — {narr_text}\n\n"
                        f"Person A: {a_snapshot['name']} ({a_snapshot['archetype']} in {a_snapshot['zone']}). "
                        f"Style: {a_snapshot.get('style','')}. Prior stance: {a_snapshot.get('stance',0):+.2f}.\n"
                        f"Person B: {b_snapshot['name']} ({b_snapshot['archetype']} in {b_snapshot['zone']}). "
                        f"Style: {b_snapshot.get('style','')}. Prior stance: {b_snapshot.get('stance',0):+.2f}.\n\n"
                        "They encounter each other briefly. Summarize the exchange and the resulting stance shifts."
                    ),
                },
            ],
            temperature=0.85,
            max_tokens=250,
        )
        summary = str(resp.get("summary", "")).strip().strip('"')[:220]
        try:
            sa = max(-0.2, min(0.2, float(resp.get("shift_a", 0.0))))
        except (TypeError, ValueError):
            sa = 0.0
        try:
            sb = max(-0.2, min(0.2, float(resp.get("shift_b", 0.0))))
        except (TypeError, ValueError):
            sb = 0.0
        return {"summary": summary, "shift_a": sa, "shift_b": sb}
    except Exception as e:
        logger.warning(f"Dialog gen failed: {e}")
        return {"summary": "", "shift_a": 0.0, "shift_b": 0.0}


def _maybe_set_migration_targets(agents: List[Agent]) -> None:
    """Phase 5: strongly-opinionated non-journalists drift toward aligned zones."""
    zone_means: Dict[str, Dict[str, float]] = {}
    zone_counts: Dict[str, int] = {}
    for a in agents:
        zone_means.setdefault(a.zone, {})
        zone_counts[a.zone] = zone_counts.get(a.zone, 0) + 1
        for n, v in a.stances.items():
            zone_means[a.zone][n] = zone_means[a.zone].get(n, 0.0) + v
    for z, d in zone_means.items():
        c = max(1, zone_counts.get(z, 1))
        for n in list(d.keys()):
            d[n] /= c

    for a in agents:
        if a.archetype == "journalist":
            continue
        if a.intensity() < 0.7:
            a.migration_target = None
            continue
        dom = a.dominant_narrative()
        if not dom:
            continue
        my_sign = 1 if a.stances[dom] > 0 else -1
        my_zone_mean = zone_means.get(a.zone, {}).get(dom, 0.0)
        if my_zone_mean * my_sign > 0.4:
            a.migration_target = None
            continue
        best, best_score = None, 0.0
        for z, d in zone_means.items():
            if z == a.zone:
                continue
            score = d.get(dom, 0.0) * my_sign
            if score > best_score and score > 0.4:
                best = z
                best_score = score
        a.migration_target = best


def _run_loop(simulation_id: str, scenario_id: str) -> None:
    scenario = SCENARIOS[scenario_id]
    agents = spawn_agents(scenario)
    agents_by_id = {a.id: a for a in agents}
    client = LLMClient()

    with _STATE_LOCK:
        SPATIAL_STATE[simulation_id]["total_ticks"] = TOTAL_TICKS
        SPATIAL_STATE[simulation_id]["status"] = "running"

    # Phase 1: personas (1 batched LLM call)
    logger.info(f"[{simulation_id}] generating personas for {len(agents)} agents…")
    personas = _generate_personas(client, agents, scenario)
    for a in agents:
        a.persona = personas.get(a.id) or _default_persona(a)

    # Expose for interview endpoint (Phase 3)
    with _STATE_LOCK:
        SPATIAL_STATE[simulation_id]["agents"] = agents
        SPATIAL_STATE[simulation_id]["scenario"] = scenario

    # Phase 4: prefill event-ticker texts
    event_schedule = _prefill_event_texts(client, scenario)
    applied_events: set = set()

    # Background pool for dialogs + dispatches (Phase 2 + 4)
    bg_pool = ThreadPoolExecutor(max_workers=4)
    pending_dialogs: List[Tuple[Future, Dict[str, Any]]] = []
    pending_dispatches: List[Tuple[Future, Dict[str, Any]]] = []
    recent_dispatch_meta: Dict[str, Dict[str, Any]] = {}

    # Tick 0: initial thoughts for seeded agents
    initial_flipped = [a.id for a in agents if a.is_informed()]
    initial_thoughts: List[Dict[str, Any]] = []
    seeded = [a for a in agents if a.is_informed()]
    if seeded:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(_generate_thought_safe, client, a, scenario, "origin"): a for a in seeded}
            for fut, a in futures.items():
                text = fut.result()
                a.record_thought(0, text, "origin")
                initial_thoughts.append({"agent_id": a.id, "tick": 0, "text": text, "trigger": "origin"})

    snap0 = _snapshot(0, agents, initial_flipped, initial_thoughts, [])
    with _STATE_LOCK:
        SPATIAL_STATE[simulation_id]["snapshots"].append(snap0)

    PERIODIC_THOUGHT_PERIOD = 8
    MAX_DIALOG_CALLS_PER_TICK = 4
    last_thought_stance: Dict[str, Dict[str, float]] = {a.id: dict(a.stances) for a in agents}

    for tick in range(1, TOTAL_TICKS + 1):
        # Phase 4: scripted events
        tick_events: List[Dict[str, Any]] = []
        for idx, ev in enumerate(event_schedule):
            if ev["tick"] == tick and idx not in applied_events:
                applied_events.add(idx)
                scope = ev.get("zone")
                nudge = ev.get("stance_nudge", {}) or {}
                for a in agents:
                    if scope and a.zone != scope:
                        continue
                    for n, delta in nudge.items():
                        try:
                            d = float(delta)
                        except (TypeError, ValueError):
                            continue
                        a.stances[n] = max(-1.0, min(1.0, a.stances.get(n, 0.0) + d * a.persona.get("susceptibility", 1.0)))
                tick_events.append({
                    "tick": tick, "kind": ev.get("kind", "event"),
                    "zone": ev.get("zone"),
                    "text": ev.get("text", ev.get("prompt_hint", "")),
                    "stance_nudge": nudge,
                })

        # Phase 5: set migration targets this tick
        _maybe_set_migration_targets(agents)

        # Move
        migrations_this_tick: List[Dict[str, Any]] = []
        for a in agents:
            prev_zone = a.zone
            _move_agent(a, tick)
            if prev_zone != a.zone:
                reason = "migration" if a.migration_target == a.zone else "wander"
                migrations_this_tick.append({
                    "tick": tick, "agent_id": a.id,
                    "from_zone": prev_zone, "to_zone": a.zone, "reason": reason,
                })
                if a.migration_target == a.zone:
                    a.migration_target = None

        # Propagate (continuous stance diffusion)
        flipped, transfers, candidate_dialogs = _propagate(agents, scenario, tick)

        # Phase 4: "recent dispatch" influence bonus on nearby agents
        for jid, meta in list(recent_dispatch_meta.items()):
            j = agents_by_id.get(jid)
            if not j or tick - meta["tick"] > 3:
                recent_dispatch_meta.pop(jid, None)
                continue
            for a in agents:
                if a.id == jid:
                    continue
                dx, dy = a.x - j.x, a.y - j.y
                if dx * dx + dy * dy <= (PROXIMITY_R * 1.5) ** 2:
                    n = meta["narrative"]
                    if n and abs(j.stances.get(n, 0.0)) > 0.1:
                        bonus = 0.08 * math.copysign(1.0, j.stances[n]) * a.persona.get("susceptibility", 1.0)
                        a.stances[n] = max(-1.0, min(1.0, a.stances.get(n, 0.0) + bonus))

        # Phase 2: submit strong encounters to background dialog pool (bounded)
        submitted = 0
        for c in candidate_dialogs:
            if submitted >= MAX_DIALOG_CALLS_PER_TICK:
                break
            a = agents_by_id.get(c["a_id"])
            b = agents_by_id.get(c["b_id"])
            if not a or not b:
                continue
            a_snap = {"name": a.name, "archetype": a.archetype, "zone": a.zone,
                      "style": a.persona.get("speaking_style", ""),
                      "stance": a.stances.get(c["narrative"], 0.0)}
            b_snap = {"name": b.name, "archetype": b.archetype, "zone": b.zone,
                      "style": b.persona.get("speaking_style", ""),
                      "stance": b.stances.get(c["narrative"], 0.0)}
            fut = bg_pool.submit(_run_dialog, client, scenario, a_snap, b_snap, c["narrative"])
            pending_dialogs.append((fut, {
                "tick_submitted": tick, "a_id": a.id, "b_id": b.id,
                "narrative": c["narrative"], "x": c["x"], "y": c["y"],
            }))
            submitted += 1

        # Harvest dialogs
        completed_dialogs: List[Dict[str, Any]] = []
        still_pending: List[Tuple[Future, Dict[str, Any]]] = []
        for fut, meta in pending_dialogs:
            if fut.done():
                try:
                    res = fut.result()
                except Exception as e:
                    logger.warning(f"Dialog future error: {e}")
                    continue
                a = agents_by_id.get(meta["a_id"])
                b = agents_by_id.get(meta["b_id"])
                n = meta["narrative"]
                if a and b and res.get("summary"):
                    a.stances[n] = max(-1.0, min(1.0, a.stances.get(n, 0.0) + res["shift_a"]))
                    b.stances[n] = max(-1.0, min(1.0, b.stances.get(n, 0.0) + res["shift_b"]))
                    completed_dialogs.append({
                        "a_id": a.id, "b_id": b.id,
                        "a_name": a.name, "b_name": b.name,
                        "narrative": n, "summary": res["summary"],
                        "shift_a": res["shift_a"], "shift_b": res["shift_b"],
                        "x": meta["x"], "y": meta["y"],
                        "submitted_at": meta["tick_submitted"], "landed_at": tick,
                    })
            else:
                still_pending.append((fut, meta))
        pending_dialogs = still_pending

        # Phase 4: journalist dispatches every 10 ticks
        dispatches_this_tick: List[Dict[str, Any]] = []
        if tick % 10 == 0:
            for j in agents:
                if j.archetype == "journalist" and j.is_informed():
                    dom = j.dominant_narrative()
                    if not dom:
                        continue
                    fut = bg_pool.submit(_generate_dispatch, client, j, scenario)
                    pending_dispatches.append((fut, {"journalist_id": j.id, "tick": tick, "narrative": dom}))

        # Harvest dispatches
        still_pending_d: List[Tuple[Future, Dict[str, Any]]] = []
        for fut, meta in pending_dispatches:
            if fut.done():
                try:
                    text = fut.result()
                except Exception as e:
                    logger.warning(f"Dispatch future error: {e}")
                    continue
                dispatches_this_tick.append({
                    "journalist_id": meta["journalist_id"], "tick": tick,
                    "submitted_at": meta["tick"], "narrative": meta["narrative"], "text": text,
                })
                recent_dispatch_meta[meta["journalist_id"]] = {"tick": tick, "narrative": meta["narrative"]}
            else:
                still_pending_d.append((fut, meta))
        pending_dispatches = still_pending_d

        # Phase 3: first-contact thoughts for newly flipped (immediate, parallel)
        new_thoughts: List[Dict[str, Any]] = []
        if flipped:
            newly = [a for a in agents if a.id in flipped]
            with ThreadPoolExecutor(max_workers=4) as pool:
                futs = {pool.submit(_generate_thought_safe, client, a, scenario, "first-contact"): a for a in newly}
                for fut, a in futs.items():
                    text = fut.result()
                    a.record_thought(tick, text, "first-contact")
                    new_thoughts.append({"agent_id": a.id, "tick": tick, "text": text, "trigger": "first-contact"})
                    last_thought_stance[a.id] = dict(a.stances)

        # Phase 3: periodic thoughts every N ticks — weighted by stance change * influence
        if tick % PERIODIC_THOUGHT_PERIOD == 0:
            scored = []
            for a in agents:
                if not a.is_informed():
                    continue
                prev = last_thought_stance.get(a.id, {})
                change = sum(abs(a.stances.get(n, 0.0) - prev.get(n, 0.0)) for n in a.stances)
                weight = (change + 0.05) * a.persona.get("influence", 1.0)
                scored.append((weight, a))
            scored.sort(key=lambda kv: -kv[0])
            picked = [a for _, a in scored[:3]]
            if picked:
                with ThreadPoolExecutor(max_workers=4) as pool:
                    futs = {pool.submit(_generate_thought_safe, client, a, scenario, "periodic"): a for a in picked}
                    for fut, a in futs.items():
                        text = fut.result()
                        a.record_thought(tick, text, "periodic")
                        new_thoughts.append({"agent_id": a.id, "tick": tick, "text": text, "trigger": "periodic"})
                        last_thought_stance[a.id] = dict(a.stances)

        snap = _snapshot(
            tick, agents, flipped, new_thoughts, transfers,
            dialogs=completed_dialogs, events=tick_events,
            dispatches=dispatches_this_tick, migrations=migrations_this_tick,
        )
        with _STATE_LOCK:
            SPATIAL_STATE[simulation_id]["snapshots"].append(snap)

        time.sleep(0.08)

    # Drain stragglers — distribute across their natural landing ticks (submitted_at + 2)
    # so the final snapshot doesn't get flooded with a burst of LLM results.
    bg_pool.shutdown(wait=True)
    with _STATE_LOCK:
        snaps_by_tick = {s["tick"]: s for s in SPATIAL_STATE[simulation_id]["snapshots"]}

    for fut, meta in pending_dialogs:
        try:
            res = fut.result()
        except Exception:
            continue
        a = agents_by_id.get(meta["a_id"])
        b = agents_by_id.get(meta["b_id"])
        n = meta["narrative"]
        if not (a and b and res.get("summary")):
            continue
        a.stances[n] = max(-1.0, min(1.0, a.stances.get(n, 0.0) + res["shift_a"]))
        b.stances[n] = max(-1.0, min(1.0, b.stances.get(n, 0.0) + res["shift_b"]))
        landed = min(meta["tick_submitted"] + 2, TOTAL_TICKS)
        target = snaps_by_tick.get(landed) or snaps_by_tick[TOTAL_TICKS]
        target["dialogs"].append({
            "a_id": a.id, "b_id": b.id,
            "a_name": a.name, "b_name": b.name,
            "narrative": n, "summary": res["summary"],
            "shift_a": res["shift_a"], "shift_b": res["shift_b"],
            "x": meta["x"], "y": meta["y"],
            "submitted_at": meta["tick_submitted"], "landed_at": landed,
        })
    for fut, meta in pending_dispatches:
        try:
            text = fut.result()
        except Exception:
            continue
        landed = min(meta["tick"] + 2, TOTAL_TICKS)
        target = snaps_by_tick.get(landed) or snaps_by_tick[TOTAL_TICKS]
        target["dispatches"].append({
            "journalist_id": meta["journalist_id"], "tick": landed,
            "submitted_at": meta["tick"], "narrative": meta["narrative"], "text": text,
        })

    report = _synthesize_report(simulation_id, agents, scenario)
    with _STATE_LOCK:
        SPATIAL_STATE[simulation_id]["status"] = "done"
        SPATIAL_STATE[simulation_id]["report"] = report
        _persist(simulation_id)


def _persist(simulation_id: str) -> None:
    sim = SPATIAL_STATE.get(simulation_id)
    if not sim:
        return
    try:
        OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
        payload = {
            "simulation_id": simulation_id,
            "scenario_id": sim.get("scenario_id"),
            "status": sim.get("status"),
            "total_ticks": sim.get("total_ticks"),
            "snapshots": sim.get("snapshots", []),
            "report": sim.get("report"),
            "finished_at": time.time(),
        }
        out = OUTPUTS_DIR / f"{simulation_id}.json"
        with open(out, "w") as f:
            json.dump(payload, f, indent=2)
        logger.info("Persisted spatial sim %s to %s", simulation_id, out)
    except Exception:
        logger.exception("Failed to persist spatial sim %s", simulation_id)


def _compute_zone_trajectories(snapshots: List[Dict[str, Any]], narratives: List[str]) -> Dict[str, Dict[str, List[float]]]:
    """zone -> narrative -> list of mean stance per tick."""
    trajectories: Dict[str, Dict[str, List[float]]] = {}
    for snap in snapshots:
        bucket: Dict[str, Dict[str, List[float]]] = {}
        for a in snap.get("agents", []):
            z = a["zone"]
            bucket.setdefault(z, {})
            for n in narratives:
                bucket[z].setdefault(n, []).append(a.get("stances", {}).get(n, 0.0))
        for z, d in bucket.items():
            trajectories.setdefault(z, {n: [] for n in narratives})
            for n in narratives:
                vals = d.get(n, [])
                mean = sum(vals) / len(vals) if vals else 0.0
                trajectories[z][n].append(mean)
    return trajectories


def _build_convert_chain(snapshots: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """BFS persuasion tree: who informed whom, traced through transfers over time."""
    first_informer: Dict[str, str] = {}  # agent_id -> id of first agent seen teaching them
    first_tick: Dict[str, int] = {}
    informed: set = set()
    agent_names: Dict[str, str] = {}

    for snap in snapshots:
        for a in snap.get("agents", []):
            agent_names[a["id"]] = a.get("name", a["id"])
            if a.get("knows") and a["id"] not in informed:
                informed.add(a["id"])
                first_tick.setdefault(a["id"], snap["tick"])
        for t in snap.get("transfers", []):
            if t["to"] not in first_informer and t["from"] != t["to"]:
                first_informer[t["to"]] = t["from"]

    chain = []
    for aid, informer in first_informer.items():
        chain.append({
            "agent_id": aid, "agent_name": agent_names.get(aid, aid),
            "informer_id": informer, "informer_name": agent_names.get(informer, informer),
            "tick": first_tick.get(aid, -1),
        })
    chain.sort(key=lambda x: x["tick"])
    return chain


def _find_dissenters(agents: List[Agent]) -> List[Dict[str, Any]]:
    """Agents whose final stance diverges ≥0.5 from their zone's mean on the dominant narrative."""
    zone_means: Dict[str, Dict[str, float]] = {}
    zone_counts: Dict[str, int] = {}
    for a in agents:
        zone_means.setdefault(a.zone, {})
        zone_counts[a.zone] = zone_counts.get(a.zone, 0) + 1
        for n, v in a.stances.items():
            zone_means[a.zone][n] = zone_means[a.zone].get(n, 0.0) + v
    for z, d in zone_means.items():
        c = max(1, zone_counts.get(z, 1))
        for n in d:
            d[n] /= c

    dissenters = []
    for a in agents:
        for n, v in a.stances.items():
            mean = zone_means.get(a.zone, {}).get(n, 0.0)
            if abs(v - mean) >= 0.5:
                dissenters.append({
                    "id": a.id, "name": a.name, "zone": a.zone, "archetype": a.archetype,
                    "narrative": n, "stance": round(v, 3), "zone_mean": round(mean, 3),
                    "divergence": round(v - mean, 3),
                    "bio": a.persona.get("bio", ""),
                })
    dissenters.sort(key=lambda d: -abs(d["divergence"]))
    return dissenters[:10]


def _find_turning_points(trajectories: Dict[str, Dict[str, List[float]]]) -> List[Dict[str, Any]]:
    """Ticks where the derivative of any zone/narrative stance mean peaks."""
    points = []
    for zone, per_narr in trajectories.items():
        for narrative, series in per_narr.items():
            if len(series) < 3:
                continue
            # First derivative
            diffs = [series[i+1] - series[i] for i in range(len(series) - 1)]
            if not diffs:
                continue
            peak_idx = max(range(len(diffs)), key=lambda i: abs(diffs[i]))
            if abs(diffs[peak_idx]) < 0.08:
                continue
            points.append({
                "tick": peak_idx + 1, "zone": zone, "narrative": narrative,
                "delta": round(diffs[peak_idx], 3),
                "value_before": round(series[peak_idx], 3),
                "value_after": round(series[peak_idx + 1], 3),
            })
    points.sort(key=lambda p: -abs(p["delta"]))
    return points[:6]


def _llm_section(
    client: LLMClient, title: str, system_prompt: str, user_prompt: str, max_tokens: int = 500
) -> Dict[str, Any]:
    """Run one LLM section; return {title, content} with error-fallback."""
    try:
        content = client.chat(
            [{"role": "system", "content": system_prompt},
             {"role": "user", "content": user_prompt}],
            temperature=0.55, max_tokens=max_tokens,
        ).strip()
    except Exception as e:
        logger.warning(f"Section '{title}' failed: {e}")
        content = f"(Section unavailable — {e})"
    return {"title": title, "content": content}


def _synthesize_report(simulation_id: str, agents: List[Agent], scenario: Dict[str, Any]) -> Dict[str, Any]:
    """Multi-section parallelized report: trajectories, convert chain, dissent, turning points, elite-vs-public."""
    narratives = list(scenario["narratives"].keys())

    # Snapshots pulled from state dict (not passed as arg to keep signature simple)
    with _STATE_LOCK:
        snapshots = list(SPATIAL_STATE.get(simulation_id, {}).get("snapshots", []))

    # Zone tallies
    by_zone: Dict[str, Dict[str, Any]] = {}
    for a in agents:
        z = by_zone.setdefault(a.zone, {"total": 0, "informed": 0, "first_tick": None, "stances": {}})
        z["total"] += 1
        if a.is_informed():
            z["informed"] += 1
            if a.learned_at_tick is not None:
                if z["first_tick"] is None or a.learned_at_tick < z["first_tick"]:
                    z["first_tick"] = a.learned_at_tick
            for n, v in a.stances.items():
                z["stances"].setdefault(n, []).append(v)
    # Collapse to mean
    for z, s in by_zone.items():
        s["stance_means"] = {n: round(sum(vs) / len(vs), 3) if vs else 0.0 for n, vs in s["stances"].items()}
        del s["stances"]

    trajectories = _compute_zone_trajectories(snapshots, narratives)
    convert_chain = _build_convert_chain(snapshots)
    dissenters = _find_dissenters(agents)
    turning_points = _find_turning_points(trajectories)

    # Format structured data for LLM consumption
    zone_lines = []
    for z in [z["name"] for z in ZONES]:
        s = by_zone.get(z)
        if not s:
            continue
        first = s["first_tick"] if s["first_tick"] is not None else "never"
        means = ", ".join(f"{n}:{v:+.2f}" for n, v in s["stance_means"].items())
        zone_lines.append(f"- {z}: {s['informed']}/{s['total']} informed (first @ T{first}); stance means: {means}")
    zone_stats_text = "\n".join(zone_lines)

    chain_preview = "\n".join(
        f"- T{c['tick']}: {c['informer_name']} → {c['agent_name']}"
        for c in convert_chain[:25]
    )
    dissent_preview = "\n".join(
        f"- {d['name']} ({d['archetype']} in {d['zone']}): stance on {d['narrative']} = {d['stance']:+.2f} vs zone mean {d['zone_mean']:+.2f}"
        for d in dissenters[:6]
    )
    turning_preview = "\n".join(
        f"- T{p['tick']} · {p['zone']}/{p['narrative']}: Δ={p['delta']:+.2f} ({p['value_before']:+.2f} → {p['value_after']:+.2f})"
        for p in turning_points
    )

    client = LLMClient()
    sections_meta = [
        (
            "Zone trajectories",
            "You write a brief analytical section on how opinion evolved in each zone over 50 ticks. 2 short paragraphs.",
            f"Scenario: {scenario['title']}\nSeed: {scenario['seed']}\n\n"
            f"Final zone stats:\n{zone_stats_text}\n\n"
            "Describe each zone's stance trajectory across the run: which zones moved, which flattened, any oscillations. Specific and concrete.",
            420,
        ),
        (
            "The persuasion chain",
            "You narrate a persuasion chain — who convinced whom — as a short piece of prose. 1-2 paragraphs.",
            f"Scenario: {scenario['title']}\n\n"
            f"First-contact chain (informer → learner, time-ordered):\n{chain_preview or '(no chain)'}\n\n"
            "Write a narrative of the top chains — journalists as connectors, who bridged zones, any surprises. Use names.",
            400,
        ),
        (
            "Dissent clusters",
            "You write a short dissent-clusters vignette: individual agents who defied their zone's majority. 1-2 paragraphs.",
            f"Scenario: {scenario['title']}\n\n"
            f"Top divergent agents (agent vs own zone mean on each narrative):\n{dissent_preview or '(no significant dissenters)'}\n\n"
            "Describe these dissenters as characters — their role, zone, what it means that they diverged.",
            360,
        ),
        (
            "Turning points",
            "You label turning points — ticks where zone opinion jumped — with brief why-this-matters commentary. 1 short paragraph.",
            f"Scenario: {scenario['title']}\n\n"
            f"Derivative peaks (top shifts):\n{turning_preview or '(no sharp turning points)'}\n\n"
            "Explain what each turning point likely corresponded to (events, journalists arriving, cascade). Tie to the scenario.",
            320,
        ),
        (
            "Elite vs public awareness",
            "You write the closing section, connecting the simulation to real-world elite-vs-public information asymmetry. 1-2 paragraphs.",
            f"Scenario: {scenario['title']}\nSeed: {scenario['seed']}\n\n"
            f"Final zone stats:\n{zone_stats_text}\n\n"
            "Close the report: which zones stayed dark, which saturated fast, what this implies for real elite vs public awareness gaps.",
            400,
        ),
    ]

    # Parallelize the 5 section generations
    sections: List[Dict[str, Any]] = [None] * len(sections_meta)  # type: ignore
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {
            pool.submit(_llm_section, client, title, sysp, userp, maxt): idx
            for idx, (title, sysp, userp, maxt) in enumerate(sections_meta)
        }
        for fut, idx in futures.items():
            try:
                sections[idx] = fut.result()
            except Exception as e:
                logger.warning(f"Section {idx} future failed: {e}")
                sections[idx] = {"title": sections_meta[idx][0], "content": "(section unavailable)"}

    # Preserve legacy `narrative` field: concatenate first three sections
    narrative = "\n\n".join(s["content"] for s in sections[:3] if s and s.get("content"))

    return {
        "scenario_id": scenario["id"],
        "scenario_title": scenario["title"],
        "zone_stats": by_zone,
        "narrative": narrative,  # legacy single-string for frontends that read report.narrative
        "sections": sections,
        "convert_chain": convert_chain,
        "dissenters": dissenters,
        "turning_points": turning_points,
        "trajectories": trajectories,
    }


def start_simulation(scenario_id: str) -> str:
    if scenario_id not in SCENARIOS:
        raise ValueError(f"Unknown scenario: {scenario_id}")
    simulation_id = f"spatial_{uuid.uuid4().hex[:10]}"
    with _STATE_LOCK:
        SPATIAL_STATE[simulation_id] = {
            "scenario_id": scenario_id,
            "status": "queued",
            "snapshots": [],
            "report": None,
            "total_ticks": TOTAL_TICKS,
        }
    thread = threading.Thread(target=_run_loop, args=(simulation_id, scenario_id), daemon=True)
    thread.start()
    logger.info(f"Started spatial sim {simulation_id} for scenario {scenario_id}")
    return simulation_id


def get_state_since(simulation_id: str, since_tick: int) -> Dict[str, Any]:
    with _STATE_LOCK:
        sim = SPATIAL_STATE.get(simulation_id)
        if sim is None:
            return {"error": "not_found"}
        snaps = [s for s in sim["snapshots"] if s["tick"] > since_tick]
        snaps = snaps[:POLL_SNAPSHOT_LIMIT]
        return {
            "scenario_id": sim["scenario_id"],
            "status": sim["status"],
            "total_ticks": sim["total_ticks"],
            "snapshots": snaps,
            "latest_tick": sim["snapshots"][-1]["tick"] if sim["snapshots"] else -1,
        }


def get_report(simulation_id: str) -> Optional[Dict[str, Any]]:
    with _STATE_LOCK:
        sim = SPATIAL_STATE.get(simulation_id)
        if sim is None or sim["status"] != "done":
            return None
        return sim["report"]


def list_persisted_runs() -> List[Dict[str, Any]]:
    """Scan outputs/spatial/ and return a summary of each persisted run (newest first)."""
    if not OUTPUTS_DIR.exists():
        return []
    runs: List[Dict[str, Any]] = []
    for path in OUTPUTS_DIR.glob("*.json"):
        try:
            with open(path) as f:
                data = json.load(f)
        except Exception as e:
            logger.warning(f"Skipping unreadable persisted run {path}: {e}")
            continue
        report = data.get("report") or {}
        runs.append({
            "simulation_id": data.get("simulation_id") or path.stem,
            "scenario_id": data.get("scenario_id"),
            "scenario_title": report.get("scenario_title") or data.get("scenario_id"),
            "total_ticks": data.get("total_ticks"),
            "snapshot_count": len(data.get("snapshots", [])),
            "finished_at": data.get("finished_at"),
        })
    runs.sort(key=lambda r: -(r.get("finished_at") or 0.0))
    return runs


def _rehydrate_agent(d: Dict[str, Any]) -> Agent:
    """Build an Agent from a persisted snapshot-agent dict."""
    a = Agent(
        id=d.get("id", ""),
        name=d.get("name", ""),
        zone=d.get("zone", ""),
        archetype=d.get("archetype", ""),
        x=float(d.get("x", 0.0)),
        y=float(d.get("y", 0.0)),
        vx=float(d.get("vx", 0.0)),
        vy=float(d.get("vy", 0.0)),
        persona=d.get("persona") or {},
        stances=dict(d.get("stances") or {}),
        exposure=dict(d.get("exposure") or {}),
        thought_log=list(d.get("thought_log") or []),
        last_interaction_tick=int(d.get("last_interaction_tick", -1) or -1),
        migration_target=d.get("migration_target"),
        last_thought=d.get("last_thought"),
        learned_at_tick=d.get("learned_at_tick"),
    )
    return a


def load_persisted_run(simulation_id: str) -> Optional[Dict[str, Any]]:
    """Load a persisted run from disk and hydrate SPATIAL_STATE so /state, /report,
    and /interview endpoints serve it as if it just finished."""
    path = OUTPUTS_DIR / f"{simulation_id}.json"
    if not path.exists():
        return None
    try:
        with open(path) as f:
            payload = json.load(f)
    except Exception as e:
        logger.warning(f"Failed to load persisted run {simulation_id}: {e}")
        return None

    snapshots = payload.get("snapshots") or []
    scenario_id = payload.get("scenario_id")
    scenario = SCENARIOS.get(scenario_id) if scenario_id else None

    agents: List[Agent] = []
    if snapshots:
        for a_dict in snapshots[-1].get("agents", []):
            agents.append(_rehydrate_agent(a_dict))

    with _STATE_LOCK:
        SPATIAL_STATE[simulation_id] = {
            "scenario_id": scenario_id,
            "status": "done",
            "snapshots": snapshots,
            "report": payload.get("report"),
            "total_ticks": payload.get("total_ticks", TOTAL_TICKS),
            "scenario": scenario,
            "agents": agents,
        }
    logger.info(f"Rehydrated persisted run {simulation_id} ({len(snapshots)} snapshots, {len(agents)} agents)")
    return payload


def interview_agent(simulation_id: str, agent_id: str, question: str) -> Dict[str, Any]:
    """Ask a specific agent a free-form question, answered in character via LLM."""
    with _STATE_LOCK:
        sim = SPATIAL_STATE.get(simulation_id)
        if sim is None:
            return {"error": "not_found"}
        agents: List[Agent] = sim.get("agents") or []
        scenario = sim.get("scenario")
    if not scenario:
        return {"error": "simulation_not_started"}
    agent = next((a for a in agents if a.id == agent_id), None)
    if agent is None:
        return {"error": "agent_not_found"}

    persona = agent.persona or {}
    stance_line = _stance_summary(agent, scenario)
    last_three = agent.thought_log[-3:] if agent.thought_log else []
    thought_history = "\n".join(f"  - T{t['tick']}: {t['text']}" for t in last_three) or "  (no recent thoughts)"

    messages = [
        {
            "role": "system",
            "content": (
                "You answer in character as a specific person in a city simulation. "
                "Stay strictly in character. 1–3 sentences. First person. "
                "Match the given speaking style. Incorporate their current opinions and zone. "
                "No hashtags. No quotes around the whole response."
            ),
        },
        {
            "role": "user",
            "content": (
                f"You are {persona.get('bio', agent.name)}.\n"
                f"Role: {agent.archetype}, currently in {agent.zone} District.\n"
                f"Ideology: {persona.get('ideology','')}\n"
                f"Speaking style: {persona.get('speaking_style','plain')}\n"
                f"Values: {', '.join(persona.get('values', []))}\n\n"
                f"Scenario backdrop: {scenario['title']} — {scenario['seed']}\n"
                f"Your current opinion balance: {stance_line}\n"
                f"Your recent thoughts:\n{thought_history}\n\n"
                f"An observer asks you: \"{question}\"\n\n"
                "Answer in character:"
            ),
        },
    ]
    client = LLMClient()
    try:
        answer = client.chat(messages, temperature=0.85, max_tokens=220).strip().strip('"')
    except Exception as e:
        logger.warning(f"Interview failed for {agent_id}: {e}")
        return {"error": f"llm_failed: {e}"}

    return {
        "agent_id": agent_id,
        "agent_name": agent.name,
        "archetype": agent.archetype,
        "zone": agent.zone,
        "question": question,
        "answer": answer,
    }


def list_scenarios() -> List[Dict[str, Any]]:
    return [
        {
            "id": s["id"],
            "title": s["title"],
            "description": s["description"],
            "origin_zones": s["origin_zones"],
            "narratives": list(s["narratives"].keys()),
        }
        for s in SCENARIOS.values()
    ]


def get_zones() -> List[Dict[str, Any]]:
    return ZONES
