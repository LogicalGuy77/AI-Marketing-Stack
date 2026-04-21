# MiroFish Spatial — Technical Writeup

## Overview

MiroFish started as a text-only multi-agent simulation where AI personas debate geopolitical narratives inside a knowledge graph. The Spatial extension adds a full second dimension to this: a living, breathing city where agents physically move through space, and information only travels as far as human proximity allows.

The core thesis is simple but powerful — **geography shapes epistemics**. In a purely text-based simulation, every agent is equally reachable. In the real world, what you believe is shaped by who you physically encounter. A market vendor in one district and a government official in another may never exchange a word, and their worldviews diverge accordingly. The Spatial layer makes this concrete and observable.

---

## From Graph to World

The most significant extension is the dynamic world generation pipeline. Previously, the simulation was hardcoded to a single scenario — "India Sides with USA" — with six fixed zones and twenty-four named agents. Now, any knowledge graph built inside MiroFish can be transformed into a unique city simulation automatically.

The process works in three stages. First, entities are read from the ZEP knowledge graph — people, organizations, nations, institutions — along with their relationships and summaries. Second, a compressed digest of these entities is sent to Claude, which generates a complete scenario: a triggering seed event, two or three competing narratives, a set of city zones with archetypes, and an event schedule. Third, the generator assigns agents to zones based on population density and zone type, drawing agent names directly from the knowledge graph entities where possible.

The result is that a graph about oil markets generates a city with port districts, industrial zones, and market squares. A graph about a diplomatic crisis generates government buildings, university campuses, and border checkpoints. The world is not generic — it reflects the subject matter of the underlying knowledge graph.

---

## The City Grid

The simulation runs on a 60×40 continuous coordinate grid representing a city. Zones are rectangles packed deterministically using a grid layout algorithm — columns and rows sized to avoid overlap, with road margins between each zone. Every zone has an archetype drawn from a vocabulary of fifteen urban types: government, university, hospital, market, military, media, residential, industrial, park, port, border, religious, slum, tech campus, and airport.

Each archetype maps to a distinct Three.js builder — a set of procedurally placed 3D geometry that makes the zone visually recognizable at a glance. An airport has a control tower and terminal hall. A port has cranes and container stacks. A religious zone has a dome and courtyard. A slum has dozens of small irregular structures at staggered heights. These are not textures or sprites — they are built from geometric primitives at runtime, driven entirely by the scenario data.

Zone colors, agent colors, and belief visualization all flow from the same data structure. There is no hardcoded color map — if the LLM generates a scenario with a `tech_campus` zone colored indigo, the 3D scene, the zone dashboard, and the story beats all use that same indigo.

---

## Agent Movement

Agents move continuously through the grid each simulation tick. The base movement model is Brownian — a damped random walk that keeps agents within their home zone through a clamping mechanism. This is intentional: it produces the right level of mixing within a zone (neighbors talk) without forcing unrealistic cross-zone contact.

Two movement exceptions layer on top of this. Journalists ignore zone boundaries entirely, hopping between zones every twelve ticks and carrying narratives across the city like vectors. Strongly opinionated agents — those whose stance has crystallized above a threshold — develop migration targets, drifting toward zones where the dominant opinion aligns with their own. This produces organic clustering: believers gather with believers, dissidents become isolated.

---

## Mesa: Spatial Neighbour Queries

The original information propagation code used a manual O(n²) loop — every agent checked every other agent for proximity each tick. This is fine at twenty agents but becomes a bottleneck as scenarios scale to sixty or more.

Mesa's `ContinuousSpace` replaces this with a spatial index backed by `scipy.spatial.distance.cdist`. Rather than iterating all pairs, each agent queries the spatial index for neighbors within a fixed proximity radius. The index is synchronized with agent positions after every movement step. The result is the same diffusion physics but with significantly better scaling — and because Mesa is a well-maintained ABM framework, it handles edge cases (boundary conditions, agent removal) correctly.

The integration is optional and gracefully degraded — if Mesa is not installed, the simulation falls back to the manual loop automatically.

---

## Information Propagation

When two agents are within proximity radius of each other, their stances on each active narrative diffuse bidirectionally. The transfer is weighted by four factors: the source agent's influence score, a tanh of their current stance (stronger beliefs propagate more effectively), an exponential distance decay, and the target agent's susceptibility score. Cognitive friction is modelled by halving the transfer rate when the source and target hold opposing views on the same narrative.

Each agent also accumulates an exposure count per narrative. The more times an agent has already heard a narrative, the less it moves them — modelling saturation and resistance to repetition.

Agents are stamped with a `learned_at_tick` when their overall stance intensity crosses the informed threshold. This produces the spreading wave patterns visible in the 3D scene — clusters light up zone by zone as information crosses spatial barriers.

---

## Concordia: LLM-Driven Narrative Events

Beyond the scripted event schedule (which the LLM pre-fills at simulation start), the Concordia Game Master runs every five ticks to generate emergent narrative events.

Concordia is Google DeepMind's open-source framework for LLM-driven agent simulations. It provides a Game Master abstraction — a component that observes the current state of a simulation and decides what happens next in the story. Rather than a hardcoded event at tick 25, the Game Master reads the actual tick-by-tick state (how many agents are informed in each zone, total spread, tick progress) and generates a contextually appropriate narrative development.

Since Concordia has no built-in Anthropic backend, a custom language model adapter was implemented — a thin subclass of Concordia's `LanguageModel` ABC that routes calls through the Anthropic SDK to Claude Sonnet. The Game Master runs synchronously inside the simulation thread, adding roughly one to three seconds per five-tick interval — acceptable for a fifty-tick simulation.

GM events appear in the simulation output alongside scripted events and are surfaced in the frontend as a distinct event type with amber highlighting. This means the story the simulation tells is never fully predetermined — the Concordia GM responds to the actual dynamics, generating a leak event when the government zone is surprisingly resistant, or a cascade warning when University and Market simultaneously tip.

---

## Personas and Dialogs

At simulation start, a single batched LLM call generates a persona for every agent — biography, ideology, speaking style, influence score, susceptibility score, and demographic attributes. These are stored on each agent and used throughout the run.

When two agents have a particularly strong encounter (high influence source, large stance shift, journalist involvement), the encounter is submitted to a background thread pool as a dialog generation request. Claude writes a two-sentence exchange between the two specific characters — grounded in their actual bios and current stances — and the resulting stance shifts are applied on top of the physics-based diffusion. This produces the "story within the story" layer that appears in the intelligence panel's event log.

Journalists also file dispatches every ten ticks — two-sentence wire-service reports colored by their dominant narrative, which then provide an influence bonus to nearby agents for three subsequent ticks.

---

## The Debrief Report

When the simulation completes, five analytical sections are generated in parallel:

**Zone trajectories** — how opinion evolved across each district over fifty ticks, including which zones moved, which flattened, and any oscillations.

**The persuasion chain** — a BFS trace through the transfer graph, reconstructed from tick-by-tick snapshot data, narrated as prose. Who was patient zero. Which journalists bridged zones. Which chains were surprisingly short.

**Dissent clusters** — agents whose final stance diverged by more than 0.5 from their zone's mean on the dominant narrative. These are the ideological holdouts — a government official who sided with the protesters, a student who ended up more conservative than the park visitors.

**Turning points** — ticks where the derivative of any zone/narrative stance mean peaked sharply. These are labelled with commentary connecting the spike to scenario context — an event that landed, a journalist who arrived, a cascade that self-organized.

**Elite vs public awareness** — a closing section connecting the simulation's geography to real-world information asymmetry: which zones stayed dark, which saturated instantly, and what this implies about how information actually moves through stratified societies.

---

## The Intelligence Panel

The frontend panel was designed in the style of a classified intelligence interface — dense, monochromatic, data-first. The panel is organized into four analytical tabs (Analysis, Chain, Dissent, Turns), a continuous event log with color-coded event-type dots, and an agent intercept feed showing the live thought stream.

Every element in the panel is driven by simulation data: zone colors come from the scenario, agent names come from the knowledge graph, narrative slugs are generated by the LLM. A replay of a persisted run loads the full embedded scenario from disk, so the panel renders correctly without any global configuration.

---

## What This Enables

The combination of these layers — dynamic world generation, spatial physics, Mesa-backed neighbor queries, Concordia-driven narrative events, LLM personas, and the analytical debrief — produces something qualitatively different from a text debate simulation.

You can watch information fail to cross a border zone. You can see a single journalist cause a cascade that wouldn't have happened without them. You can identify the exact tick when the market district tipped, and read the GM's account of what story development triggered it. You can find the one agent in the government district who broke rank and trace exactly who told them what.

This is MiroFish extended into physical space — the same question about how narratives compete and how information propagates, but grounded in the geography that shapes it in the real world.
