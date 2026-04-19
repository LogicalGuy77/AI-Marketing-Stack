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

import random
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple

from ..utils.llm_client import LLMClient
from ..utils.logger import get_logger

logger = get_logger("mirofish.spatial")


GRID_W = 60
GRID_H = 40
PROXIMITY_R = 6.0
TOTAL_TICKS = 50
POLL_SNAPSHOT_LIMIT = 1000


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
    "sides_with_iran": {
        "id": "sides_with_iran",
        "title": "India Sides with Iran",
        "seed": (
            "India announces a strategic partnership with Iran, joins the SCO "
            "energy corridor, and distances itself from the QUAD framework."
        ),
        "origin_zones": ["Government"],
        "narratives": {
            "official_realpolitik": (
                "Pragmatic realignment: energy security and strategic autonomy "
                "justify closer ties with Iran despite Western pushback."
            ),
        },
        "journalist_count": 3,
        "description": (
            "News originates inside the Government District. Watch it cascade "
            "outward through journalists to Market and University, while "
            "Residential and Park zones remain uninformed late into the run."
        ),
    },
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
        "journalist_count": 4,
        "description": (
            "Two competing narratives originate simultaneously in Government "
            "and University. Journalists carry different stories; the Market "
            "is the first zone to hear both, producing confused thoughts."
        ),
    },
}


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
    knows: bool = False
    belief: Optional[str] = None
    last_thought: Optional[str] = None
    learned_at_tick: Optional[int] = None

    def as_dict(self, flipped_this_tick: bool = False) -> Dict[str, Any]:
        d = asdict(self)
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
    for agent in agents:
        if agent.zone in origin_zones:
            agent.knows = True
            agent.learned_at_tick = 0
            if len(narratives) == 1:
                agent.belief = narratives[0]
            else:
                if agent.zone == "Government":
                    agent.belief = narratives[0]
                else:
                    agent.belief = narratives[1] if len(narratives) > 1 else narratives[0]
    return agents


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
    else:
        agent.vx = 0.7 * agent.vx + random.uniform(-0.4, 0.4)
        agent.vy = 0.7 * agent.vy + random.uniform(-0.4, 0.4)
        agent.x += agent.vx
        agent.y += agent.vy
        _clamp_in_zone(agent)


def _propagate(agents: List[Agent], scenario: Dict[str, Any]) -> Tuple[List[str], List[Dict[str, Any]]]:
    """Return (flipped_ids, transfer_events) for this tick.

    transfer_events: list of {from, to, belief} describing who taught whom.
    """
    flipped: List[str] = []
    transfers: List[Dict[str, Any]] = []
    narratives = list(scenario["narratives"].keys())
    competing = len(narratives) > 1

    informed = [a for a in agents if a.knows]
    uninformed = [a for a in agents if not a.knows]
    for u in uninformed:
        for i in informed:
            dx, dy = u.x - i.x, u.y - i.y
            if dx * dx + dy * dy <= PROXIMITY_R * PROXIMITY_R:
                u.knows = True
                if competing and random.random() < 0.15:
                    u.belief = random.choice(narratives)
                else:
                    u.belief = i.belief
                flipped.append(u.id)
                transfers.append({
                    "from": i.id,
                    "to": u.id,
                    "belief": u.belief,
                })
                break
    return flipped, transfers


def _thought_prompt(agent: Agent, scenario: Dict[str, Any]) -> List[Dict[str, str]]:
    narrative_text = scenario["narratives"].get(agent.belief or "", "")
    return [
        {
            "role": "system",
            "content": (
                "You voice the inner thought of one person reacting to breaking "
                "news. Return one sentence (max 20 words). First person. Specific "
                "to their role and zone. No hashtags. No quotes."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Role: {agent.name} ({agent.archetype}) in {agent.zone} District.\n"
                f"News: {scenario['seed']}\n"
                f"Your framing: {narrative_text}\n"
                "Inner thought:"
            ),
        },
    ]


def _generate_thought_safe(client: LLMClient, agent: Agent, scenario: Dict[str, Any]) -> str:
    try:
        return client.chat(
            _thought_prompt(agent, scenario),
            temperature=0.85,
            max_tokens=60,
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
) -> Dict[str, Any]:
    flipped_set = set(flipped)
    return {
        "tick": tick,
        "agents": [a.as_dict(flipped_this_tick=(a.id in flipped_set)) for a in agents],
        "new_thoughts": new_thoughts,
        "transfers": transfers,
    }


def _run_loop(simulation_id: str, scenario_id: str) -> None:
    scenario = SCENARIOS[scenario_id]
    agents = spawn_agents(scenario)
    client = LLMClient()

    with _STATE_LOCK:
        SPATIAL_STATE[simulation_id]["total_ticks"] = TOTAL_TICKS
        SPATIAL_STATE[simulation_id]["status"] = "running"

    initial_flipped = [a.id for a in agents if a.knows]
    initial_thoughts: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_generate_thought_safe, client, a, scenario): a for a in agents if a.knows}
        for fut, a in futures.items():
            text = fut.result()
            a.last_thought = text
            initial_thoughts.append({"agent_id": a.id, "tick": 0, "text": text})

    snap0 = _snapshot(0, agents, initial_flipped, initial_thoughts, [])
    with _STATE_LOCK:
        SPATIAL_STATE[simulation_id]["snapshots"].append(snap0)

    for tick in range(1, TOTAL_TICKS + 1):
        for a in agents:
            _move_agent(a, tick)
        flipped, transfers = _propagate(agents, scenario)

        new_thoughts: List[Dict[str, Any]] = []
        if flipped:
            newly = [a for a in agents if a.id in flipped]
            with ThreadPoolExecutor(max_workers=4) as pool:
                futs = {pool.submit(_generate_thought_safe, client, a, scenario): a for a in newly}
                for fut, a in futs.items():
                    text = fut.result()
                    a.last_thought = text
                    a.learned_at_tick = tick
                    new_thoughts.append({"agent_id": a.id, "tick": tick, "text": text})

        snap = _snapshot(tick, agents, flipped, new_thoughts, transfers)
        with _STATE_LOCK:
            SPATIAL_STATE[simulation_id]["snapshots"].append(snap)

        time.sleep(0.08)

    report = _synthesize_report(agents, scenario)
    with _STATE_LOCK:
        SPATIAL_STATE[simulation_id]["status"] = "done"
        SPATIAL_STATE[simulation_id]["report"] = report


def _synthesize_report(agents: List[Agent], scenario: Dict[str, Any]) -> Dict[str, Any]:
    """One LLM call summarizing the spread dynamics."""
    by_zone: Dict[str, Dict[str, Any]] = {}
    for a in agents:
        z = by_zone.setdefault(a.zone, {"total": 0, "informed": 0, "first_tick": None, "beliefs": {}})
        z["total"] += 1
        if a.knows:
            z["informed"] += 1
            if a.learned_at_tick is not None:
                if z["first_tick"] is None or a.learned_at_tick < z["first_tick"]:
                    z["first_tick"] = a.learned_at_tick
            if a.belief:
                z["beliefs"][a.belief] = z["beliefs"].get(a.belief, 0) + 1

    zone_lines = []
    for name in [z["name"] for z in ZONES]:
        s = by_zone.get(name)
        if not s:
            continue
        first = s["first_tick"] if s["first_tick"] is not None else "never"
        beliefs = ", ".join(f"{k}:{v}" for k, v in s["beliefs"].items()) or "—"
        zone_lines.append(f"- {name}: {s['informed']}/{s['total']} informed (first @ tick {first}; beliefs: {beliefs})")

    stats_text = "\n".join(zone_lines)
    client = LLMClient()
    try:
        narrative = client.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "You write a concise 'information geography' report for a "
                        "swarm simulation. 3 short paragraphs. Plain prose, no lists."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Scenario: {scenario['title']}\nSeed: {scenario['seed']}\n\n"
                        f"Zone stats at end of run:\n{stats_text}\n\n"
                        "Explain: (1) which zones saturated first and why, "
                        "(2) which zones lagged or stayed uninformed and why, "
                        "(3) what this pattern implies about real-world elite-vs-public awareness."
                    ),
                },
            ],
            temperature=0.5,
            max_tokens=400,
        )
    except Exception as e:
        logger.warning(f"Report synth failed: {e}")
        narrative = "Report synthesis unavailable (LLM error). Raw zone stats:\n" + stats_text

    return {
        "scenario_id": scenario["id"],
        "scenario_title": scenario["title"],
        "zone_stats": by_zone,
        "narrative": narrative,
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
