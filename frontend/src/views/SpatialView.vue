<template>
  <div class="cinema-root">
    <!-- PHASE 1: picker -->
    <template v-if="phase === 'pick'">
      <ScenarioPicker
        :scenarios="scenarios"
        :completed-ids="[]"
        :previous-runs="previousRuns"
        @pick="startScenario"
        @replay="replayRun"
      />
      <!-- Generate from graph button overlaid at bottom of picker -->
      <div class="gen-bar">
        <div class="gen-bar-label">Generate a dynamic world from a knowledge graph:</div>
        <input
          v-model="generateGraphId"
          class="gen-bar-input"
          placeholder="Enter graph ID…"
          @keydown.enter="generateGraphId && generateFromGraph(generateGraphId)"
        />
        <button
          class="gen-bar-btn"
          :disabled="!generateGraphId"
          @click="generateFromGraph(generateGraphId)"
        >Generate World ⚡</button>
        <div v-if="generationError" class="gen-bar-error">{{ generationError }}</div>
      </div>
    </template>

    <!-- PHASE 1.5: generating (spinner) -->
    <div v-else-if="phase === 'generating'" class="gen-loading">
      <div class="gen-spinner"></div>
      <div class="gen-label">Generating world from graph…</div>
      <div class="gen-sub">Reading entities and crafting scenario with AI</div>
    </div>

    <!-- PHASE 1.75: preview (generated scenario card) -->
    <div v-else-if="phase === 'preview' && generatedScenario" class="gen-preview">
      <div class="gp-card">
        <div class="gp-tag">AI GENERATED</div>
        <div class="gp-title">{{ generatedScenario.title }}</div>
        <div class="gp-seed">{{ generatedScenario.seed }}</div>
        <div class="gp-zones">
          <span v-for="z in generatedScenario.zones" :key="z.name" class="gp-zone-chip" :style="{ background: z.color || '#3b82f6' }">
            {{ z.name }}
          </span>
        </div>
        <div class="gp-narratives">
          <span v-for="(text, slug) in generatedScenario.narratives" :key="slug" class="gp-narr-pill">
            {{ slug.replace(/_/g, ' ') }}
          </span>
        </div>
        <div class="gp-actions">
          <button class="gp-btn primary" @click="startGeneratedScenario(generatedScenario)">Play this world</button>
          <button class="gp-btn ghost" @click="phase = 'pick'">Back</button>
        </div>
      </div>
    </div>

    <!-- PHASE 2: cinematic player -->
    <div v-else-if="phase === 'play'" class="stage">
      <!-- 3D scene fills the viewport -->
      <div class="scene-wrap">
        <canvas ref="canvasRef"></canvas>
        <!-- Cinematic vignette edges -->
        <div class="vignette"></div>
        <div class="letterbox top"></div>
        <div class="letterbox bottom"></div>
      </div>

      <!-- Top bar -->
      <div class="hud-top">
        <router-link to="/" class="logo">
          <span class="logo-diamond">◇</span>
          <span class="logo-text">MIROFISH <span class="logo-sub">· SPATIAL</span></span>
        </router-link>

        <div class="title-card">
          <div class="title-tag" :class="statusClass">
            <span class="status-pip"></span>
            {{ statusLabel }}
          </div>
          <div class="title-name">{{ currentScenario?.title }}</div>
          <div class="title-sub">Information propagation in a simulated city · {{ totalTicks }} ticks</div>
        </div>

        <div class="stat-ring">
          <div class="stat">
            <div class="stat-num mono">{{ currentTick }}<span class="stat-total">/{{ totalTicks }}</span></div>
            <div class="stat-lbl">TICK</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat">
            <div class="stat-num mono">{{ informedCount }}<span class="stat-total">/{{ totalAgents }}</span></div>
            <div class="stat-lbl">INFORMED</div>
          </div>
        </div>
      </div>

      <!-- Event ticker banner (scripted mid-sim events) -->
      <transition name="event-banner">
        <div v-if="activeEventBanner" class="event-banner" :class="'k-' + activeEventBanner.kind">
          <div class="eb-badge">
            <span class="eb-pip"></span>
            <span>{{ (activeEventBanner.kind || 'event').toUpperCase() }}</span>
          </div>
          <div class="eb-text">{{ activeEventBanner.text }}</div>
          <div class="eb-tick mono">T{{ String(activeEventBanner.tick).padStart(2, '0') }}</div>
        </div>
      </transition>

      <!-- Zone dashboard (bottom-left) — live macro view of each district -->
      <aside class="zone-dashboard">
        <div class="zd-head">
          <span class="zd-title">CITY · LIVE STATE</span>
          <span class="zd-tick mono">T{{ String(currentTick).padStart(2, '0') }}</span>
        </div>
        <div class="zd-body">
          <div v-for="z in zoneStats" :key="z.name" class="zrow" :class="{ active: z.informed > 0 }">
            <div class="zrow-head">
              <span class="zrow-dot" :style="{ background: zoneColor(z.name) }"></span>
              <span class="zrow-name">{{ z.name }}</span>
              <span class="zrow-count mono">{{ z.informed }}/{{ z.total }}</span>
            </div>
            <div class="zrow-bar">
              <div class="zrow-fill" :style="{
                  width: (z.total ? (z.informed / z.total) * 100 : 0) + '%',
                  background: zoneColor(z.name),
                }"></div>
            </div>
            <div v-if="z.dominant" class="zrow-stance">
              <span class="zst-track">
                <span class="zst-zero"></span>
                <span class="zst-fill" :style="{
                    left: z.dominant.value >= 0 ? '50%' : (50 - Math.min(1, Math.abs(z.dominant.value)) * 50) + '%',
                    width: (Math.min(1, Math.abs(z.dominant.value)) * 50) + '%',
                    background: narrativeHexColor(z.dominant.narrative),
                  }"></span>
              </span>
              <span class="zst-lbl mono" :style="{ color: narrativeHexColor(z.dominant.narrative) }">
                {{ shortNarrative(z.dominant.narrative) }}
                {{ (z.dominant.value >= 0 ? '+' : '') + z.dominant.value.toFixed(2) }}
              </span>
            </div>
            <div v-else class="zrow-stance zrow-quiet">— no formed opinion</div>
          </div>
        </div>
        <div class="zd-legend">
          <span v-for="(n, i) in beliefLabels" :key="n" class="zd-leg">
            <span class="zd-leg-dot" :style="{ background: narrativeHexColor(n) }"></span>
            {{ shortNarrative(n) }}
          </span>
        </div>
      </aside>

      <!-- Agent info panel (left drawer) -->
      <div class="agent-panel-wrap">
        <AgentInfoPanel
          :agent="selectedAgent"
          :narratives="narrativeMap"
          :sim-id="currentSimId"
          @close="closeAgentPanel"
        />
      </div>

      <!-- Right drawer: summary + thoughts -->
      <aside class="drawer" :class="{ open: drawerOpen }">
        <button class="drawer-toggle" @click="drawerOpen = !drawerOpen" :title="drawerOpen ? 'Hide' : 'Show'">
          <span v-if="drawerOpen">▶</span>
          <span v-else>◀</span>
        </button>

        <div class="drawer-scroll">
          <div class="drawer-section">
            <div class="drawer-label">DEBRIEF</div>
            <div v-if="!report" class="drawer-pending">
              <span class="pulse"></span>
              The simulation is still running. The debrief will synthesize once all {{ totalTicks }} ticks complete.
            </div>
            <template v-else>
              <div class="debrief-tabs">
                <button
                  v-for="t in debriefTabs"
                  :key="t.id"
                  class="dtab"
                  :class="{ active: debriefTab === t.id }"
                  @click="debriefTab = t.id"
                >{{ t.label }}<span v-if="t.count" class="dtab-n mono">·{{ t.count }}</span></button>
              </div>

              <div v-if="debriefTab === 'sections'" class="debrief-sections">
                <template v-if="report.sections?.length">
                  <div v-for="(s, i) in report.sections" :key="i" class="debrief-section">
                    <div class="debrief-section-title">{{ s.title }}</div>
                    <div class="debrief-section-body">{{ s.content }}</div>
                  </div>
                </template>
                <div v-else class="drawer-summary">{{ report.narrative || 'No summary available.' }}</div>
              </div>

              <div v-if="debriefTab === 'chain'" class="debrief-list">
                <div v-if="!report.convert_chain?.length" class="drawer-empty">No chain recorded.</div>
                <div v-for="(c, i) in report.convert_chain" :key="i" class="chain-row">
                  <span class="chain-tick mono">T{{ String(c.tick).padStart(2, '0') }}</span>
                  <span class="chain-name">{{ c.informer_name }}</span>
                  <span class="chain-arrow">→</span>
                  <span class="chain-name">{{ c.agent_name }}</span>
                </div>
              </div>

              <div v-if="debriefTab === 'dissent'" class="debrief-list">
                <div v-if="!report.dissenters?.length" class="drawer-empty">No significant dissenters.</div>
                <div v-for="(d, i) in report.dissenters" :key="i" class="dissent-card">
                  <div class="dissent-head">
                    <span class="dissent-name">{{ d.name }}</span>
                    <span class="dissent-zone mono">· {{ d.zone }} · {{ d.archetype }}</span>
                  </div>
                  <div v-if="d.bio" class="dissent-bio">{{ d.bio }}</div>
                  <div class="dissent-metric">
                    <span class="mono dissent-key">{{ d.narrative?.replace(/_/g, ' ') }}</span>
                    <span class="dissent-stance" :class="d.stance >= 0 ? 'pos' : 'neg'">stance {{ (d.stance >= 0 ? '+' : '') + d.stance.toFixed(2) }}</span>
                    <span class="dissent-vs mono">vs zone {{ (d.zone_mean >= 0 ? '+' : '') + d.zone_mean.toFixed(2) }}</span>
                  </div>
                </div>
              </div>

              <div v-if="debriefTab === 'turning'" class="debrief-list">
                <div v-if="!report.turning_points?.length" class="drawer-empty">No sharp turning points.</div>
                <div v-for="(p, i) in report.turning_points" :key="i" class="turning-row">
                  <span class="chain-tick mono">T{{ String(p.tick).padStart(2, '0') }}</span>
                  <div class="turning-body">
                    <div class="turning-head">
                      <span class="turning-zone">{{ p.zone }}</span>
                      <span class="turning-narr mono">{{ p.narrative?.replace(/_/g, ' ') }}</span>
                    </div>
                    <div class="turning-delta">
                      Δ {{ (p.delta >= 0 ? '+' : '') + p.delta.toFixed(2) }}
                      <span class="turning-sub mono">{{ (p.value_before >= 0 ? '+' : '') + p.value_before.toFixed(2) }} → {{ (p.value_after >= 0 ? '+' : '') + p.value_after.toFixed(2) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <div class="drawer-section">
            <div class="drawer-label">STORY BEATS · {{ storyBeats.length }}</div>
            <div v-if="!storyBeats.length" class="drawer-empty">Beats will appear as the story unfolds…</div>
            <div v-else class="beats">
              <button
                v-for="(b, i) in storyBeats"
                :key="i"
                class="beat"
                :class="['k-' + b.kind, { active: b.tick === activeBeat.tick && b.kind === activeBeat.kind }]"
                @click="seekTo(b.tick)"
              >
                <span class="beat-tick mono">T{{ String(b.tick).padStart(2, '0') }}</span>
                <span class="beat-kind">{{ b.kind }}</span>
                <span class="beat-text">{{ b.text }}</span>
              </button>
            </div>
          </div>

          <div class="drawer-section drawer-thoughts">
            <div class="drawer-label">LIVE THOUGHT STREAM · {{ visibleThoughts.length }}</div>
            <div v-if="visibleThoughts.length === 0" class="drawer-empty">
              No agents have spoken yet. Watch the lights spread…
            </div>
            <div v-else class="thought-feed">
              <div v-for="t in reversedThoughts" :key="t.key" class="tcard">
                <div class="tcard-bar" :style="{ background: zoneColor(t.zone) }"></div>
                <div class="tcard-body">
                  <div class="tcard-meta">
                    <span class="tcard-who">{{ t.name }}</span>
                    <span class="tcard-zone" :style="{ color: zoneColor(t.zone) }">{{ t.zone.toUpperCase() }}</span>
                    <span class="tcard-tick mono">T{{ String(t.tick).padStart(2, '0') }}</span>
                  </div>
                  <div class="tcard-text">"{{ t.text }}"</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Narrator caption strip — "what's happening right now" -->
      <transition name="caption-fade">
        <div class="caption" :key="activeBeat.tick + '-' + activeBeat.kind">
          <div class="caption-tick mono">T{{ String(activeBeat.tick).padStart(2, '0') }}</div>
          <div class="caption-kind" :class="'k-' + activeBeat.kind">{{ (activeBeat.kind || 'intro').toUpperCase() }}</div>
          <div class="caption-text">{{ activeBeat.text }}</div>
        </div>
      </transition>

      <!-- Bottom cinematic player bar -->
      <div class="player">
        <button class="btn-play" @click="togglePlay" :disabled="loadedMaxTick < 0">
          <svg v-if="isPlaying" width="14" height="14" viewBox="0 0 14 14">
            <rect x="2" y="1" width="3.5" height="12" fill="currentColor" />
            <rect x="8.5" y="1" width="3.5" height="12" fill="currentColor" />
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 14 14">
            <path d="M2 1 L13 7 L2 13 Z" fill="currentColor" />
          </svg>
        </button>

        <div class="scrub-wrap">
          <div class="scrub-loaded" :style="{ width: loadedPct + '%' }"></div>
          <div class="scrub-played" :style="{ width: playedPct + '%' }"></div>
          <input
            type="range"
            class="scrub-input"
            min="0"
            :max="totalTicks"
            :value="currentTick"
            :step="1"
            @input="onScrub"
          />
          <div class="scrub-chapters">
            <button
              v-for="(b, i) in storyBeats"
              :key="i"
              class="chapter"
              :class="'k-' + b.kind"
              :style="{ left: (b.tick / totalTicks * 100) + '%' }"
              :title="`T${b.tick} · ${b.text}`"
              @click="seekTo(b.tick)"
            ></button>
          </div>
          <div class="scrub-ticklabels">
            <span v-for="m in tickMarkers" :key="m" class="scrub-marker" :style="{ left: (m / totalTicks * 100) + '%' }">
              {{ m }}
            </span>
          </div>
        </div>

        <div class="time-label mono">
          <span class="time-cur">{{ currentTick }}</span>
          <span class="time-sep">/</span>
          <span class="time-tot">{{ totalTicks }}</span>
        </div>

        <div class="speed-group">
          <button
            v-for="s in speeds"
            :key="s"
            class="speed-btn"
            :class="{ active: playSpeed === s }"
            @click="playSpeed = s"
          >{{ s }}×</button>
        </div>

        <button class="btn-ghost" @click="resetAll" title="New run">
          <span class="btn-ghost-label">NEW RUN</span>
        </button>
      </div>
    </div>

    <div v-else class="loader">Loading scenarios…</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { CityScene } from '../components/spatial/CityScene.js'
import ScenarioPicker from '../components/spatial/ScenarioPicker.vue'
import AgentInfoPanel from '../components/spatial/AgentInfoPanel.vue'
// SceneLegend replaced by inline ZoneDashboard — kept file for possible reuse
import {
  getSpatialScenarios,
  startSpatialSim,
  generateSpatialScenario,
  getSpatialState,
  getSpatialReport,
  listSpatialRuns,
  loadSpatialRun,
} from '../api/spatial.js'

const phase = ref('pick') // pick | generating | preview | play
const scenarios = ref([])
const previousRuns = ref([])
const zones = ref([])
const grid = ref({ w: 60, h: 40 })
const totalTicks = ref(50)

const currentScenario = ref(null)
const currentSimId = ref(null)
const simStatus = ref('loading') // loading | done

const generatedScenario = ref(null)
const generationError = ref(null)
const generateGraphId = ref('')

const snapshotsByTick = ref(new Map())
const loadedMaxTick = ref(-1)
const currentTick = ref(0)

const thoughts = ref([])
const agentIndex = ref(new Map())

const report = ref(null)

const isPlaying = ref(true)
const speeds = [0.5, 1, 2, 4]
const playSpeed = ref(1)
const BASE_TICKS_PER_SECOND = 50 / 30  // 50 ticks in ~30s at 1× — cinematic pacing

const drawerOpen = ref(true)
const debriefTab = ref('sections')
const debriefTabs = computed(() => [
  { id: 'sections', label: 'Analysis', count: report.value?.sections?.length || 0 },
  { id: 'chain',    label: 'Chain',    count: report.value?.convert_chain?.length || 0 },
  { id: 'dissent',  label: 'Dissent',  count: report.value?.dissenters?.length || 0 },
  { id: 'turning',  label: 'Turns',    count: report.value?.turning_points?.length || 0 },
])

const canvasRef = ref(null)
let scene = null
let pollHandle = null
let rafHandle = null
let lastFrameTs = 0
let tickAccumulator = 0

const selectedAgent = ref(null)

// Derived from zones.value so dynamic scenarios get correct colors automatically
const zoneColor = (z) => {
  const found = zones.value.find((zn) => zn.name === z)
  return found?.color || '#94a3b8'
}

const statusClass = computed(() =>
  simStatus.value === 'done' ? 'status-done' : (phase.value === 'play' ? 'status-live' : 'status-idle')
)
const statusLabel = computed(() => {
  if (simStatus.value === 'loading') return `LIVE · LOADING TICK ${Math.max(0, loadedMaxTick.value)}`
  if (isPlaying.value) return 'REPLAY · PLAYING'
  return 'REPLAY · PAUSED'
})

const currentSnapshot = computed(() => snapshotsByTick.value.get(currentTick.value) || null)
const totalAgents = computed(() => currentSnapshot.value?.agents?.length ?? 0)
const informedCount = computed(() => currentSnapshot.value?.agents?.filter((a) => a.knows).length ?? 0)

/* ---------------- Zone dashboard (live macro view) ---------------- */
const NARRATIVE_HEX = ['#ef4444', '#facc15', '#3b82f6', '#10b981', '#a855f7']
function narrativeHexColor(name) {
  const idx = beliefLabels.value.indexOf(name)
  return NARRATIVE_HEX[idx >= 0 ? idx % NARRATIVE_HEX.length : 0]
}
function shortNarrative(n) {
  if (!n) return ''
  return String(n).replace(/_/g, ' ').toUpperCase()
}
const zoneStats = computed(() => {
  const zoneNames = zones.value.length
    ? zones.value.map((z) => z.name)
    : ['Government', 'University', 'Market', 'Industrial', 'Residential', 'Park']
  const out = zoneNames.map((name) => ({
    name,
    total: 0,
    informed: 0,
    stanceSum: {},
    count: 0,
  }))
  const snap = currentSnapshot.value
  if (snap && snap.agents) {
    const byName = new Map(out.map((z) => [z.name, z]))
    for (const a of snap.agents) {
      const z = byName.get(a.zone)
      if (!z) continue
      z.total += 1
      z.count += 1
      if (a.knows) z.informed += 1
      if (a.stances) {
        for (const [n, v] of Object.entries(a.stances)) {
          z.stanceSum[n] = (z.stanceSum[n] || 0) + Number(v || 0)
        }
      }
    }
  }
  return out.map((z) => {
    const means = {}
    for (const [n, sum] of Object.entries(z.stanceSum)) {
      means[n] = z.count > 0 ? sum / z.count : 0
    }
    const entries = Object.entries(means)
    entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    const top = entries[0]
    const dominant = top && Math.abs(top[1]) >= 0.08 ? { narrative: top[0], value: top[1] } : null
    return { name: z.name, total: z.total, informed: z.informed, dominant, means }
  })
})
const loadedPct = computed(() => totalTicks.value ? Math.max(0, (loadedMaxTick.value / totalTicks.value) * 100) : 0)
const playedPct = computed(() => totalTicks.value ? (currentTick.value / totalTicks.value) * 100 : 0)
const beliefLabels = computed(() => {
  const n = currentScenario.value?.narratives
  if (!n) return []
  if (Array.isArray(n)) return n
  return Object.keys(n)  // dynamic scenario: narratives is a slug→text object
})
const narrativeMap = computed(() => {
  const n = currentScenario.value?.narratives
  if (!n) return currentScenario.value?.narrative_map ?? {}
  if (Array.isArray(n)) return currentScenario.value?.narrative_map ?? {}
  return n  // dynamic scenario: narratives is already slug→text
})
const visibleThoughts = computed(() => thoughts.value.filter((t) => t.tick <= currentTick.value))
const reversedThoughts = computed(() => visibleThoughts.value.slice().reverse())

/* ---------------- Story beats (narrator) ---------------- */
// Scans loaded snapshots and emits structured events: origin, first-contact, journalist moves,
// zone saturation, last holdout. These drive the caption strip & timeline markers.
const storyBeats = computed(() => {
  const out = []
  const maxT = loadedMaxTick.value
  if (maxT < 0) return out
  const snaps = []
  for (let t = 0; t <= maxT; t++) {
    const s = snapshotsByTick.value.get(t)
    if (s) snaps.push(s)
  }
  if (!snaps.length) return out

  const zoneTotals = new Map()
  const zoneFirst = new Map()
  const zoneSaturated = new Map()
  const zoneFinished = new Map()
  const informed = new Set()
  const prevZoneByAgent = new Map()

  for (const a of snaps[0].agents) {
    zoneTotals.set(a.zone, (zoneTotals.get(a.zone) || 0) + 1)
    prevZoneByAgent.set(a.id, a.zone)
  }
  // Origin beat from tick-0 seeded agents
  const originZones = new Set()
  for (const a of snaps[0].agents) {
    if (a.knows) {
      informed.add(a.id)
      originZones.add(a.zone)
      if (!zoneFirst.has(a.zone)) zoneFirst.set(a.zone, 0)
    }
  }
  if (originZones.size) {
    out.push({
      tick: 0,
      kind: 'origin',
      text: `The news breaks in ${[...originZones].join(' + ')}.`,
    })
  }

  for (const snap of snaps) {
    // Phase 4: scripted events + Concordia GM events from snapshot
    for (const ev of snap.events || []) {
      const kind = ev.kind === 'gm_event' ? 'gm_event' : 'event'
      out.push({
        tick: snap.tick,
        kind,
        zone: ev.zone,
        text: ev.text || `${ev.kind} in ${ev.zone || 'city'}`,
      })
    }
    // Phase 4: journalist dispatches
    for (const ds of snap.dispatches || []) {
      out.push({
        tick: snap.tick,
        kind: 'dispatch',
        text: ds.text ? `Dispatch: ${ds.text}` : 'Journalist dispatch filed.',
      })
    }
    // Phase 2: LLM dialogs
    for (const d of snap.dialogs || []) {
      out.push({
        tick: d.landed_at ?? snap.tick,
        kind: 'dialog',
        text: d.summary ? `${d.a_name} ↔ ${d.b_name}: ${d.summary}` : `${d.a_name} and ${d.b_name} discuss ${d.narrative?.replace(/_/g, ' ') || 'the news'}.`,
      })
    }
    // Phase 5: migrations
    for (const m of snap.migrations || []) {
      if (m.reason === 'migration') {
        const ag = agentIndex.value.get(m.agent_id)
        const name = ag?.name || m.agent_id
        out.push({
          tick: snap.tick,
          kind: 'migration',
          text: `${name} crosses from ${m.from_zone} into ${m.to_zone}, drawn by conviction.`,
        })
      }
    }

    const flipsByZone = new Map()
    for (const a of snap.agents) {
      // First-contact in a zone
      if (a.knows && !informed.has(a.id)) {
        informed.add(a.id)
        flipsByZone.set(a.zone, (flipsByZone.get(a.zone) || 0) + 1)
        if (!zoneFirst.has(a.zone)) {
          zoneFirst.set(a.zone, snap.tick)
          out.push({
            tick: snap.tick,
            kind: 'first',
            zone: a.zone,
            who: a.name,
            text: `${a.name} is the first in ${a.zone} to hear.`,
          })
        }
      }
      // Journalist boundary crossing
      if (a.archetype === 'journalist') {
        const prev = prevZoneByAgent.get(a.id)
        if (prev && prev !== a.zone) {
          out.push({
            tick: snap.tick,
            kind: 'journalist',
            zone: a.zone,
            who: a.name,
            text: `${a.name} walks into ${a.zone}, carrying the story.`,
          })
          prevZoneByAgent.set(a.id, a.zone)
        }
      }
    }
    // Cascade detection (>=3 new in one zone this tick, beyond the first-contact)
    for (const [zone, count] of flipsByZone) {
      if (count >= 3) {
        out.push({
          tick: snap.tick,
          kind: 'cascade',
          zone,
          text: `Cascade in ${zone}: ${count} more minds flip this tick.`,
        })
      }
    }
    // Saturation
    for (const [zone, total] of zoneTotals) {
      if (zoneSaturated.has(zone)) continue
      const inf = snap.agents.filter((x) => x.zone === zone && x.knows).length
      if (inf / total >= 0.75 && inf >= 3) {
        zoneSaturated.set(zone, snap.tick)
        out.push({
          tick: snap.tick,
          kind: 'saturated',
          zone,
          text: `${zone} reaches saturation (${inf}/${total} informed).`,
        })
      }
      if (!zoneFinished.has(zone) && inf === total && total > 1) {
        zoneFinished.set(zone, snap.tick)
        out.push({
          tick: snap.tick,
          kind: 'finished',
          zone,
          text: `Entire ${zone} is now informed.`,
        })
      }
    }
  }

  // End-of-run silence: zones that never heard
  if (simStatus.value === 'done') {
    const finalSnap = snaps[snaps.length - 1]
    for (const [zone, total] of zoneTotals) {
      const inf = finalSnap.agents.filter((x) => x.zone === zone && x.knows).length
      if (inf === 0) {
        out.push({
          tick: totalTicks.value,
          kind: 'dark',
          zone,
          text: `${zone} never hears the news — ${total} lives untouched.`,
        })
      }
    }
  }
  return out.sort((a, b) => a.tick - b.tick)
})

const activeEventBanner = computed(() => {
  // Show the most recent scripted event within a 4-tick window so it lingers visibly
  const candidates = storyBeats.value.filter(
    (b) => (b.kind === 'event' || b.kind === 'dispatch') &&
           b.tick <= currentTick.value &&
           currentTick.value - b.tick <= 4
  )
  if (!candidates.length) return null
  return candidates[candidates.length - 1]
})

const activeBeat = computed(() => {
  const visible = storyBeats.value.filter((b) => b.tick <= currentTick.value)
  if (!visible.length) {
    return {
      tick: 0,
      kind: 'intro',
      text: currentScenario.value?.description || 'Simulation opening…',
    }
  }
  return visible[visible.length - 1]
})

function seekTo(tick) {
  isPlaying.value = false
  currentTick.value = Math.min(tick, Math.max(0, loadedMaxTick.value))
}

const tickMarkers = computed(() => {
  const n = totalTicks.value
  if (!n) return []
  const out = []
  for (let i = 0; i <= n; i += Math.max(1, Math.round(n / 5))) out.push(i)
  if (out[out.length - 1] !== n) out.push(n)
  return out
})

async function generateFromGraph(graphId) {
  generationError.value = null
  generatedScenario.value = null
  phase.value = 'generating'
  try {
    const resp = await generateSpatialScenario(graphId)
    generatedScenario.value = resp.scenario
    phase.value = 'preview'
  } catch (e) {
    generationError.value = e?.response?.data?.error || e?.message || 'Generation failed.'
    phase.value = 'pick'
  }
}

async function startGeneratedScenario(scenario) {
  const sc = scenario || generatedScenario.value
  if (!sc) return
  zones.value = sc.zones || []
  grid.value = { w: 60, h: 40 }
  totalTicks.value = sc.total_ticks || 50
  currentScenario.value = {
    id: sc.id,
    title: sc.title,
    seed: sc.seed,
    description: sc.description,
    narratives: Object.keys(sc.narratives || {}),
    narrative_map: sc.narratives || {},
  }
  snapshotsByTick.value = new Map()
  thoughts.value = []
  agentIndex.value = new Map()
  currentTick.value = 0
  loadedMaxTick.value = -1
  report.value = null
  simStatus.value = 'loading'
  isPlaying.value = true
  playSpeed.value = 1
  drawerOpen.value = true
  phase.value = 'play'

  const resp = await startSpatialSim(null, sc)
  currentSimId.value = resp.simulation_id

  await nextTick()
  await waitForCanvasSize(canvasRef)
  if (scene) scene.dispose()
  selectedAgent.value = null
  scene = new CityScene()
  scene.init(canvasRef.value, grid.value, zones.value)
  scene.onAgentSelect = (a) => { selectedAgent.value = a }

  startPlaybackLoop()
  pollLoop()
}

async function loadScenarios() {
  const r = await getSpatialScenarios()
  scenarios.value = r.scenarios
  zones.value = r.zones
  grid.value = r.grid
  totalTicks.value = r.total_ticks
}

async function startScenario(scenarioId) {
  currentScenario.value = scenarios.value.find((s) => s.id === scenarioId)
  snapshotsByTick.value = new Map()
  thoughts.value = []
  agentIndex.value = new Map()
  currentTick.value = 0
  loadedMaxTick.value = -1
  report.value = null
  simStatus.value = 'loading'
  isPlaying.value = true
  playSpeed.value = 1
  drawerOpen.value = true
  phase.value = 'play'

  const resp = await startSpatialSim(scenarioId)
  currentSimId.value = resp.simulation_id

  await nextTick()
  await waitForCanvasSize(canvasRef)
  if (scene) scene.dispose()
  selectedAgent.value = null
  scene = new CityScene()
  scene.init(canvasRef.value, grid.value, zones.value)
  scene.onAgentSelect = (a) => { selectedAgent.value = a }

  startPlaybackLoop()
  pollLoop()
}

function waitForCanvasSize(ref) {
  return new Promise((resolve) => {
    const check = () => {
      const el = ref.value
      if (el && el.clientWidth > 0 && el.clientHeight > 0) resolve()
      else requestAnimationFrame(check)
    }
    check()
  })
}

function closeAgentPanel() {
  selectedAgent.value = null
  if (scene) {
    scene.selectedId = null
    scene._refreshSelectionRing?.()
  }
}

async function pollLoop() {
  if (!currentSimId.value || simStatus.value === 'done') return
  try {
    const data = await getSpatialState(currentSimId.value, loadedMaxTick.value)
    const firstLoad = loadedMaxTick.value < 0
    // Pick up zones from state response (populated for dynamic scenarios)
    if (data.zones && data.zones.length && !zones.value.length) {
      zones.value = data.zones
    }
    for (const snap of data.snapshots) {
      if (snapshotsByTick.value.has(snap.tick)) continue
      snapshotsByTick.value.set(snap.tick, snap)
      if (snap.tick > loadedMaxTick.value) loadedMaxTick.value = snap.tick
      for (const a of snap.agents) {
        if (!agentIndex.value.has(a.id)) {
          agentIndex.value.set(a.id, { name: a.name, zone: a.zone })
        } else {
          agentIndex.value.get(a.id).zone = a.zone
        }
      }
      for (const t of snap.new_thoughts || []) {
        const ag = agentIndex.value.get(t.agent_id) || { name: t.agent_id, zone: '?' }
        thoughts.value.push({
          key: `${t.agent_id}-${t.tick}-${thoughts.value.length}`,
          tick: t.tick,
          name: ag.name,
          zone: ag.zone,
          text: t.text,
        })
      }
    }

    if (firstLoad && snapshotsByTick.value.has(0) && currentTick.value === 0) {
      renderTick(0)
    }

    if (data.status === 'done' && data.latest_tick >= totalTicks.value) {
      const rep = await getSpatialReport(currentSimId.value)
      report.value = rep
      simStatus.value = 'done'
      return
    }
  } catch (e) {
    console.error('Spatial poll error', e)
  }
  pollHandle = setTimeout(pollLoop, 400)
}

function togglePlay() {
  if (currentTick.value >= totalTicks.value) currentTick.value = 0
  isPlaying.value = !isPlaying.value
}

function onScrub(ev) {
  const t = Number(ev.target.value)
  isPlaying.value = false
  currentTick.value = Math.min(t, Math.max(0, loadedMaxTick.value))
}

function startPlaybackLoop() {
  cancelAnimationFrame(rafHandle)
  lastFrameTs = performance.now()
  tickAccumulator = 0
  const step = (ts) => {
    const dt = Math.min(0.1, (ts - lastFrameTs) / 1000)
    lastFrameTs = ts
    if (isPlaying.value && currentTick.value < loadedMaxTick.value) {
      tickAccumulator += dt * BASE_TICKS_PER_SECOND * playSpeed.value
      while (tickAccumulator >= 1 && currentTick.value < loadedMaxTick.value) {
        currentTick.value++
        tickAccumulator -= 1
      }
      if (currentTick.value >= totalTicks.value) isPlaying.value = false
    } else {
      tickAccumulator = 0
    }
    rafHandle = requestAnimationFrame(step)
  }
  rafHandle = requestAnimationFrame(step)
}

function renderTick(tick) {
  const snap = snapshotsByTick.value.get(tick)
  if (!snap || !scene) return
  scene.setState(snap, currentScenario.value?.narratives ?? [])
  if (selectedAgent.value) {
    const fresh = snap.agents.find((a) => a.id === selectedAgent.value.id)
    if (fresh) selectedAgent.value = fresh
  }
}

watch(currentTick, (tick) => renderTick(tick))

async function resetAll() {
  if (pollHandle) { clearTimeout(pollHandle); pollHandle = null }
  if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null }
  if (scene) { scene.dispose(); scene = null }
  currentSimId.value = null
  report.value = null
  snapshotsByTick.value = new Map()
  thoughts.value = []
  loadedMaxTick.value = -1
  currentTick.value = 0
  simStatus.value = 'loading'
  phase.value = 'pick'
  loadPreviousRuns()
}

async function loadPreviousRuns() {
  try {
    const r = await listSpatialRuns()
    previousRuns.value = r?.runs || []
  } catch (e) {
    console.warn('Failed to list runs', e)
    previousRuns.value = []
  }
}

async function replayRun(simId) {
  // Hydrate a persisted sim without hitting any LLM endpoints
  currentScenario.value = null
  snapshotsByTick.value = new Map()
  thoughts.value = []
  agentIndex.value = new Map()
  currentTick.value = 0
  loadedMaxTick.value = -1
  report.value = null
  simStatus.value = 'loading'
  isPlaying.value = true
  playSpeed.value = 1
  drawerOpen.value = true
  phase.value = 'play'

  let payload
  try {
    payload = await loadSpatialRun(simId)
  } catch (e) {
    console.error('Replay load failed', e)
    phase.value = 'pick'
    return
  }

  currentSimId.value = payload.simulation_id
  // Use embedded scenario if present (dynamic runs), else find in loaded list
  const scenarioId = payload.scenario_id
  const embeddedScenario = payload.scenario
  if (embeddedScenario?.zones?.length) {
    zones.value = embeddedScenario.zones
  }
  currentScenario.value = scenarios.value.find((s) => s.id === scenarioId) || embeddedScenario || {
    id: scenarioId,
    title: payload.report?.scenario_title || scenarioId,
    narratives: [],
  }

  // Rebuild snapshotsByTick + thoughts + agentIndex from persisted snapshots
  const snaps = payload.snapshots || []
  for (const snap of snaps) {
    snapshotsByTick.value.set(snap.tick, snap)
    for (const a of snap.agents || []) {
      if (!agentIndex.value.has(a.id)) {
        agentIndex.value.set(a.id, { name: a.name, zone: a.zone })
      } else {
        agentIndex.value.get(a.id).zone = a.zone
      }
    }
    for (const t of snap.new_thoughts || []) {
      const ag = agentIndex.value.get(t.agent_id) || { name: t.agent_id, zone: '?' }
      thoughts.value.push({
        key: `${t.agent_id}-${t.tick}-${thoughts.value.length}`,
        tick: t.tick,
        name: ag.name,
        zone: ag.zone,
        text: t.text,
      })
    }
  }
  loadedMaxTick.value = snaps.length ? snaps[snaps.length - 1].tick : -1
  report.value = payload.report
  simStatus.value = 'done'

  await nextTick()
  await waitForCanvasSize(canvasRef)
  if (scene) scene.dispose()
  selectedAgent.value = null
  scene = new CityScene()
  scene.init(canvasRef.value, grid.value, zones.value)
  scene.onAgentSelect = (a) => { selectedAgent.value = a }

  startPlaybackLoop()
  // Kick-render tick 0 immediately
  if (snapshotsByTick.value.has(0)) renderTick(0)
}

onMounted(async () => {
  await loadScenarios()
  loadPreviousRuns()  // fire-and-forget
})

onBeforeUnmount(() => {
  if (pollHandle) clearTimeout(pollHandle)
  if (rafHandle) cancelAnimationFrame(rafHandle)
  if (scene) scene.dispose()
})
</script>

<style scoped>
/* ============================================================
   Cinematic dark theme
   ============================================================ */
/* Generate bar (overlaid on picker, bottom of screen) */
.gen-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 14px 28px;
  background: rgba(5, 7, 13, 0.9);
  backdrop-filter: blur(12px);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 20;
  flex-wrap: wrap;
}
.gen-bar-label { font-size: 12px; color: #8490a8; white-space: nowrap; }
.gen-bar-input {
  flex: 1;
  min-width: 180px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 8px 14px;
  color: #e6edf9;
  font-size: 13px;
  outline: none;
  font-family: 'JetBrains Mono', monospace;
}
.gen-bar-input:focus { border-color: #ffa13a; }
.gen-bar-btn {
  background: #ffa13a;
  color: #05070d;
  border: none;
  border-radius: 6px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.gen-bar-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.gen-bar-btn:not(:disabled):hover { background: #ffb35a; }
.gen-bar-error { font-size: 12px; color: #fca5a5; width: 100%; }

/* GM events get a distinct amber color in beats */
.beat.k-gm_event { border-color: rgba(251, 191, 36, 0.4); }
.beat.k-gm_event .beat-kind { color: #fbbf24; }
.caption .k-gm_event { color: #fbbf24; }

/* Generating / preview phases */
.gen-loading {
  position: fixed;
  inset: 0;
  background: #05070d;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: #e6edf9;
}
.gen-spinner {
  width: 48px;
  height: 48px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #ffa13a;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.gen-label { font-size: 18px; font-weight: 600; }
.gen-sub { font-size: 13px; color: #8490a8; }
.gen-error {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 13px;
  z-index: 10;
}

.gen-preview {
  position: fixed;
  inset: 0;
  background: #05070d;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gp-card {
  background: rgba(16, 22, 38, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 36px 40px;
  max-width: 560px;
  width: 90%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.gp-tag {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #ffa13a;
  font-family: 'JetBrains Mono', monospace;
}
.gp-title { font-size: 22px; font-weight: 700; color: #e6edf9; }
.gp-seed { font-size: 13px; color: #8490a8; line-height: 1.6; }
.gp-zones { display: flex; flex-wrap: wrap; gap: 6px; }
.gp-zone-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
  color: #fff;
  opacity: 0.9;
}
.gp-narratives { display: flex; flex-wrap: wrap; gap: 6px; }
.gp-narr-pill {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #c8d2e4;
  font-family: 'JetBrains Mono', monospace;
}
.gp-actions { display: flex; gap: 12px; margin-top: 8px; }
.gp-btn {
  padding: 10px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: none;
}
.gp-btn.primary { background: #ffa13a; color: #05070d; }
.gp-btn.primary:hover { background: #ffb35a; }
.gp-btn.ghost {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #8490a8;
}
.gp-btn.ghost:hover { border-color: rgba(255, 255, 255, 0.3); color: #c8d2e4; }

.cinema-root {
  position: fixed;
  inset: 0;
  background: #05070d;
  color: #e6edf9;
  font-family: 'Inter', 'SF Pro Display', -apple-system, sans-serif;
  overflow: hidden;
}

.stage {
  position: absolute;
  inset: 0;
}

/* 3D scene area */
.scene-wrap {
  position: absolute;
  inset: 0;
}
.scene-wrap canvas {
  display: block;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* Cinematic vignette + letterbox */
.vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at center, transparent 55%, rgba(0, 0, 0, 0.6) 100%),
    linear-gradient(180deg, rgba(5, 7, 13, 0.5) 0%, transparent 15%, transparent 80%, rgba(5, 7, 13, 0.75) 100%);
}
.letterbox {
  position: absolute;
  left: 0;
  right: 0;
  height: 40px;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0));
}
.letterbox.top { top: 0; height: 30px; background: linear-gradient(180deg, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0)); }
.letterbox.bottom {
  bottom: 0;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0));
  height: 80px;
}

/* Top HUD */
.hud-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 18px 28px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  pointer-events: none;
  z-index: 3;
}
.logo {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #e6edf9;
  text-decoration: none;
  pointer-events: auto;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 2.5px;
  padding: 10px 16px;
  background: rgba(10, 14, 24, 0.55);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  height: fit-content;
  transition: all 0.2s;
}
.logo:hover { border-color: rgba(255, 179, 71, 0.35); color: #ffc072; }
.logo-diamond { color: #ffa13a; font-size: 14px; }
.logo-sub { color: #8490a8; letter-spacing: 2px; }

.title-card {
  flex: 1;
  max-width: 480px;
  text-align: center;
  padding: 10px 22px 12px;
  background: linear-gradient(180deg, rgba(10, 14, 24, 0.5), rgba(10, 14, 24, 0.2));
  backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  pointer-events: auto;
}
.title-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 2.5px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 3px;
  margin-bottom: 8px;
}
.title-tag.status-live {
  background: rgba(234, 88, 12, 0.18);
  color: #fdba74;
  border: 1px solid rgba(234, 88, 12, 0.5);
}
.title-tag.status-done {
  background: rgba(22, 163, 74, 0.18);
  color: #86efac;
  border: 1px solid rgba(22, 163, 74, 0.5);
}
.title-tag.status-idle {
  background: rgba(100, 116, 139, 0.18);
  color: #cbd5e1;
  border: 1px solid rgba(100, 116, 139, 0.35);
}
.status-pip {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  animation: pip 1.4s ease-in-out infinite;
}
.status-done .status-pip { animation: none; }
@keyframes pip {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}
.title-name {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.2px;
  color: #ffffff;
  margin-bottom: 3px;
}
.title-sub {
  font-size: 10.5px;
  color: #8490a8;
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: 1.2px;
}

.stat-ring {
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 10px 18px;
  background: rgba(10, 14, 24, 0.55);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  pointer-events: auto;
}
.stat { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 0 14px; }
.stat-num {
  font-size: 22px;
  font-weight: 700;
  color: #ffc072;
  line-height: 1;
  letter-spacing: -0.5px;
}
.stat-total { color: #64748b; font-size: 14px; font-weight: 500; }
.stat-lbl {
  font-size: 9.5px;
  letter-spacing: 2.2px;
  color: #64748b;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
}
.stat-divider {
  width: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 4px 0;
}
.mono { font-family: 'JetBrains Mono', monospace; }

/* Legend — bottom-left overlay */
/* Zone dashboard — live macro view at bottom-left */
.zone-dashboard {
  position: absolute;
  left: 24px;
  bottom: 108px;
  width: 280px;
  max-height: calc(100vh - 280px);
  display: flex;
  flex-direction: column;
  background: rgba(10, 14, 24, 0.78);
  backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.5);
  z-index: 3;
  pointer-events: auto;
  overflow: hidden;
}
.zd-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.zd-title {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  letter-spacing: 2.4px;
  font-weight: 700;
  color: #ffc072;
}
.zd-tick { font-size: 13px; font-weight: 700; color: #ffffff; }
.zd-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}
.zd-body::-webkit-scrollbar { width: 4px; }
.zd-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); }
.zrow {
  display: flex;
  flex-direction: column;
  gap: 4px;
  opacity: 0.55;
  transition: opacity 0.25s;
}
.zrow.active { opacity: 1; }
.zrow-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
}
.zrow-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  box-shadow: 0 0 8px currentColor;
  flex-shrink: 0;
}
.zrow-name {
  flex: 1;
  color: #e6edf9;
  font-weight: 600;
  font-size: 11.5px;
  letter-spacing: 0.2px;
}
.zrow-count { font-size: 10.5px; color: #94a3b8; font-weight: 700; }
.zrow-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
  overflow: hidden;
}
.zrow-fill {
  height: 100%;
  transition: width 0.35s ease;
  box-shadow: 0 0 6px currentColor;
}
.zrow-stance {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.zst-track {
  position: relative;
  height: 4px;
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 2px;
  overflow: hidden;
}
.zst-zero {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.18);
}
.zst-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  transition: left 0.35s ease, width 0.35s ease;
  box-shadow: 0 0 6px currentColor;
}
.zst-lbl {
  font-size: 9.5px;
  letter-spacing: 1px;
  min-width: 82px;
  text-align: right;
  font-weight: 700;
}
.zrow-quiet {
  font-size: 10px;
  color: #475569;
  font-style: italic;
  padding-left: 2px;
}
.zd-legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  padding: 9px 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px;
  letter-spacing: 1px;
  color: #94a3b8;
}
.zd-leg { display: flex; align-items: center; gap: 5px; }
.zd-leg-dot { width: 7px; height: 7px; border-radius: 50%; box-shadow: 0 0 6px currentColor; }

/* Agent panel slot */
.agent-panel-wrap {
  position: absolute;
  top: 120px;
  left: 24px;
  width: 340px;
  max-width: calc(100vw - 48px);
  z-index: 3;
  pointer-events: auto;
}

/* Right drawer */
.drawer {
  position: absolute;
  top: 100px;
  right: 0;
  bottom: 110px;
  width: 380px;
  background: rgba(10, 14, 24, 0.78);
  backdrop-filter: blur(18px);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  transform: translateX(100%);
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 3;
  display: flex;
  flex-direction: column;
}
.drawer.open { transform: translateX(0); }
.drawer-toggle {
  position: absolute;
  left: -32px;
  top: 20px;
  width: 32px;
  height: 52px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-right: 0;
  border-radius: 8px 0 0 8px;
  background: rgba(10, 14, 24, 0.78);
  backdrop-filter: blur(14px);
  color: #cbd5e1;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.drawer-toggle:hover { color: #ffc072; border-color: rgba(255, 179, 71, 0.3); }

.drawer-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 22px 24px 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 26px;
}
.drawer-scroll::-webkit-scrollbar { width: 6px; }
.drawer-scroll::-webkit-scrollbar-track { background: transparent; }
.drawer-scroll::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 3px; }

.drawer-section { display: flex; flex-direction: column; gap: 10px; }
.drawer-section.drawer-thoughts { flex: 1; min-height: 0; }
.drawer-label {
  font-size: 10px;
  letter-spacing: 2.5px;
  font-weight: 700;
  color: #ffc072;
  font-family: 'JetBrains Mono', monospace;
}
.drawer-summary {
  font-size: 13px;
  line-height: 1.65;
  color: #cbd5e1;
  white-space: pre-wrap;
  padding: 14px 16px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.drawer-pending {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 8px;
  background: rgba(234, 88, 12, 0.07);
  border: 1px solid rgba(234, 88, 12, 0.2);
  color: #fdba74;
  font-size: 12.5px;
  line-height: 1.55;
  font-style: italic;
}
.pulse {
  flex-shrink: 0;
  margin-top: 5px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ea580c;
  animation: pip 1.4s ease-in-out infinite;
}
.drawer-empty {
  font-size: 12.5px;
  color: #64748b;
  font-style: italic;
  padding: 12px 0;
}

.thought-feed {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tcard {
  display: flex;
  gap: 10px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  overflow: hidden;
  animation: tcard-in 0.45s ease-out;
}
@keyframes tcard-in {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}
.tcard-bar { width: 3px; flex-shrink: 0; }
.tcard-body { flex: 1; padding: 10px 12px 12px 10px; }
.tcard-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 10.5px;
  font-family: 'JetBrains Mono', monospace;
}
.tcard-who { font-weight: 700; color: #ffffff; letter-spacing: 0.2px; }
.tcard-zone { font-weight: 700; letter-spacing: 1px; }
.tcard-tick { color: #64748b; margin-left: auto; }
.tcard-text {
  font-size: 12.5px;
  line-height: 1.55;
  color: #cbd5e1;
  font-style: italic;
}

/* Caption strip — narrator */
.caption {
  position: absolute;
  left: 50%;
  bottom: 108px;
  transform: translateX(-50%);
  max-width: 720px;
  min-width: 420px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 22px;
  background: linear-gradient(180deg, rgba(10, 14, 24, 0.85), rgba(10, 14, 24, 0.75));
  backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  z-index: 4;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
}
.caption-tick {
  font-size: 15px;
  font-weight: 700;
  color: #ffc072;
  letter-spacing: -0.2px;
  flex-shrink: 0;
}
.caption-kind {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 2px;
  padding: 3px 8px;
  border-radius: 3px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.06);
  color: #94a3b8;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.caption-kind.k-origin { background: rgba(255, 179, 71, 0.18); color: #ffc072; border-color: rgba(255, 179, 71, 0.45); }
.caption-kind.k-first { background: rgba(239, 68, 68, 0.18); color: #fca5a5; border-color: rgba(239, 68, 68, 0.45); }
.caption-kind.k-journalist { background: rgba(168, 85, 247, 0.18); color: #d8b4fe; border-color: rgba(168, 85, 247, 0.45); }
.caption-kind.k-cascade { background: rgba(250, 204, 21, 0.18); color: #fde68a; border-color: rgba(250, 204, 21, 0.45); }
.caption-kind.k-saturated { background: rgba(16, 185, 129, 0.18); color: #6ee7b7; border-color: rgba(16, 185, 129, 0.45); }
.caption-kind.k-finished { background: rgba(59, 130, 246, 0.18); color: #93c5fd; border-color: rgba(59, 130, 246, 0.45); }
.caption-kind.k-dark { background: rgba(100, 116, 139, 0.18); color: #cbd5e1; border-color: rgba(100, 116, 139, 0.4); }
.caption-kind.k-event { background: rgba(34, 211, 238, 0.15); color: #67e8f9; border-color: rgba(34, 211, 238, 0.45); }
.caption-kind.k-dispatch { background: rgba(249, 115, 22, 0.18); color: #fdba74; border-color: rgba(249, 115, 22, 0.45); }
.caption-kind.k-dialog { background: rgba(244, 114, 182, 0.18); color: #fbcfe8; border-color: rgba(244, 114, 182, 0.4); }
.caption-kind.k-migration { background: rgba(20, 184, 166, 0.18); color: #5eead4; border-color: rgba(20, 184, 166, 0.4); }
.caption-text {
  flex: 1;
  font-size: 14.5px;
  font-weight: 500;
  color: #f0f4ff;
  line-height: 1.45;
  letter-spacing: -0.1px;
}
.caption-fade-enter-active { transition: all 0.45s cubic-bezier(0.22, 1, 0.36, 1); }
.caption-fade-leave-active { position: absolute; transition: all 0.3s ease-in; }
.caption-fade-enter-from { opacity: 0; transform: translateX(-50%) translateY(10px); }
.caption-fade-leave-to { opacity: 0; transform: translateX(-50%) translateY(-6px); }

/* Chapter markers on scrubber */
.scrub-chapters {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 18px;
  transform: translateY(-50%);
  pointer-events: none;
}
.chapter {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  border: 1.5px solid rgba(255, 255, 255, 0.6);
  cursor: pointer;
  pointer-events: auto;
  padding: 0;
  transition: transform 0.15s, background 0.15s;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.5);
}
.chapter:hover { transform: translate(-50%, -50%) scale(1.35); }
.chapter.k-origin { background: #ffb347; border-color: #ffb347; }
.chapter.k-first { background: #ef4444; border-color: #ef4444; }
.chapter.k-journalist { background: #a855f7; border-color: #a855f7; }
.chapter.k-cascade { background: #facc15; border-color: #facc15; }
.chapter.k-saturated { background: #10b981; border-color: #10b981; }
.chapter.k-finished { background: #3b82f6; border-color: #3b82f6; }
.chapter.k-dark { background: #64748b; border-color: #64748b; }
.chapter.k-event { background: #22d3ee; border-color: #22d3ee; }
.chapter.k-dispatch { background: #f97316; border-color: #f97316; }
.chapter.k-dialog { background: #f472b6; border-color: #f472b6; }
.chapter.k-migration { background: #14b8a6; border-color: #14b8a6; }

/* Story beats list in drawer */
.beats { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; padding-right: 2px; }
.beats::-webkit-scrollbar { width: 4px; }
.beats::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }
.beat {
  display: grid;
  grid-template-columns: 36px 64px 1fr;
  align-items: start;
  gap: 8px;
  text-align: left;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-left: 3px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
  transition: all 0.15s;
}
.beat:hover { border-color: rgba(255, 179, 71, 0.4); border-left-color: rgba(255, 179, 71, 0.6); }
.beat.active { background: rgba(255, 179, 71, 0.08); border-color: rgba(255, 179, 71, 0.5); border-left-color: #ffc072; }
.beat.k-origin { border-left-color: #ffb347; }
.beat.k-first { border-left-color: #ef4444; }
.beat.k-journalist { border-left-color: #a855f7; }
.beat.k-cascade { border-left-color: #facc15; }
.beat.k-saturated { border-left-color: #10b981; }
.beat.k-finished { border-left-color: #3b82f6; }
.beat.k-dark { border-left-color: #64748b; }
.beat.k-event { border-left-color: #22d3ee; }
.beat.k-dispatch { border-left-color: #f97316; }
.beat.k-dialog { border-left-color: #f472b6; }
.beat.k-migration { border-left-color: #14b8a6; }
.beat-tick { font-size: 11px; color: #ffc072; font-weight: 700; padding-top: 1px; }
.beat-kind {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  letter-spacing: 1.3px;
  color: #94a3b8;
  text-transform: uppercase;
  padding-top: 2px;
}
.beat-text { font-size: 12px; color: #cbd5e1; line-height: 1.45; }

/* Bottom player bar */
.player {
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 18px;
  height: 68px;
  padding: 0 22px;
  background: rgba(10, 14, 24, 0.78);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  display: flex;
  align-items: center;
  gap: 20px;
  z-index: 5;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.5);
}
.btn-play {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 0;
  background: linear-gradient(180deg, #ffb347, #ea580c);
  color: #0a0e18;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s, box-shadow 0.2s;
  box-shadow: 0 4px 16px rgba(234, 88, 12, 0.35);
  flex-shrink: 0;
}
.btn-play:hover:not(:disabled) { transform: scale(1.06); box-shadow: 0 6px 22px rgba(234, 88, 12, 0.5); }
.btn-play:disabled { background: rgba(255, 255, 255, 0.08); color: #475569; cursor: not-allowed; box-shadow: none; }

.scrub-wrap {
  flex: 1;
  height: 44px;
  position: relative;
  display: flex;
  align-items: center;
}
.scrub-loaded {
  position: absolute;
  top: 50%;
  left: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.12);
  transform: translateY(-50%);
  border-radius: 2px;
  transition: width 0.2s ease;
  pointer-events: none;
}
.scrub-played {
  position: absolute;
  top: 50%;
  left: 0;
  height: 3px;
  background: linear-gradient(90deg, #ffb347, #ea580c);
  transform: translateY(-50%);
  border-radius: 2px;
  box-shadow: 0 0 10px rgba(255, 179, 71, 0.6);
  pointer-events: none;
}
.scrub-input {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  cursor: pointer;
  margin: 0;
}
.scrub-ticklabels {
  position: absolute;
  bottom: 2px;
  left: 0;
  right: 0;
  height: 10px;
  pointer-events: none;
}
.scrub-marker {
  position: absolute;
  transform: translateX(-50%);
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.5px;
  color: #475569;
}

.time-label {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 15px;
  font-weight: 700;
  min-width: 70px;
  justify-content: center;
}
.time-cur { color: #ffc072; }
.time-sep { color: #334155; }
.time-tot { color: #64748b; font-size: 13px; }

.speed-group { display: flex; gap: 4px; padding: 0 10px; border-left: 1px solid rgba(255, 255, 255, 0.08); }
.speed-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  padding: 6px 10px;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  color: #94a3b8;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: 0.5px;
}
.speed-btn:hover { color: #ffffff; border-color: rgba(255, 179, 71, 0.4); }
.speed-btn.active {
  background: rgba(255, 179, 71, 0.18);
  color: #ffc072;
  border-color: rgba(255, 179, 71, 0.6);
}

.btn-ghost {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 8px 14px;
  color: #cbd5e1;
  cursor: pointer;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
  transition: all 0.15s;
}
.btn-ghost:hover { border-color: rgba(255, 179, 71, 0.5); color: #ffc072; }

.loader {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  color: #94a3b8;
  font-family: 'JetBrains Mono', monospace;
}

/* Event ticker banner — top of screen */
.event-banner {
  position: absolute;
  left: 50%;
  top: 100px;
  transform: translateX(-50%);
  max-width: 860px;
  min-width: 440px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 20px;
  background: linear-gradient(180deg, rgba(8, 18, 28, 0.92), rgba(8, 18, 28, 0.78));
  backdrop-filter: blur(18px);
  border: 1px solid rgba(34, 211, 238, 0.4);
  border-radius: 10px;
  z-index: 4;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45), 0 0 24px rgba(34, 211, 238, 0.12);
}
.event-banner.k-dispatch {
  border-color: rgba(249, 115, 22, 0.45);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45), 0 0 24px rgba(249, 115, 22, 0.15);
}
.eb-badge {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 2.5px;
  color: #22d3ee;
  padding: 3px 9px;
  border: 1px solid currentColor;
  border-radius: 3px;
  flex-shrink: 0;
}
.event-banner.k-dispatch .eb-badge { color: #fdba74; }
.eb-pip {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: currentColor;
  animation: pip 1.3s infinite;
}
.eb-text {
  flex: 1;
  font-size: 14.5px;
  font-weight: 500;
  color: #f0f4ff;
  line-height: 1.4;
}
.eb-tick { font-size: 13px; font-weight: 700; color: #ffc072; flex-shrink: 0; }
.event-banner-enter-active { transition: all 0.5s cubic-bezier(0.22, 1, 0.36, 1); }
.event-banner-leave-active { transition: all 0.35s ease-in; }
.event-banner-enter-from { opacity: 0; transform: translateX(-50%) translateY(-14px); }
.event-banner-leave-to { opacity: 0; transform: translateX(-50%) translateY(-8px); }

/* Debrief tabs */
.debrief-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 8px;
}
.dtab {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px 5px 0 0;
  padding: 6px 10px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  letter-spacing: 1.2px;
  color: #94a3b8;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
}
.dtab:hover { color: #ffc072; }
.dtab.active {
  color: #ffc072;
  border-color: rgba(255, 179, 71, 0.45);
  background: rgba(255, 179, 71, 0.08);
}
.dtab-n { color: #475569; margin-left: 5px; font-weight: 500; }

.debrief-sections { display: flex; flex-direction: column; gap: 14px; }
.debrief-section {
  background: rgba(255, 255, 255, 0.03);
  border-left: 2px solid rgba(255, 179, 71, 0.5);
  padding: 10px 14px;
  border-radius: 4px;
}
.debrief-section-title {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  letter-spacing: 1.8px;
  color: #ffc072;
  font-weight: 700;
  margin-bottom: 6px;
}
.debrief-section-body {
  font-size: 13px;
  line-height: 1.6;
  color: #cbd5e1;
  white-space: pre-wrap;
}

.debrief-list { display: flex; flex-direction: column; gap: 6px; }
.chain-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  background: rgba(255, 255, 255, 0.025);
  border-radius: 4px;
  font-size: 12.5px;
}
.chain-tick { color: #ffc072; font-weight: 700; font-size: 11px; min-width: 34px; }
.chain-name { color: #e6edf9; font-weight: 600; }
.chain-arrow { color: #64748b; }
.dissent-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 6px;
  padding: 9px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.dissent-head { display: flex; align-items: baseline; gap: 8px; }
.dissent-name { font-size: 13px; font-weight: 700; color: #fca5a5; }
.dissent-zone { font-size: 10.5px; color: #94a3b8; }
.dissent-bio { font-size: 12px; color: #cbd5e1; font-style: italic; line-height: 1.4; }
.dissent-metric { display: flex; align-items: center; gap: 10px; font-size: 11px; }
.dissent-key { color: #94a3b8; letter-spacing: 1px; }
.dissent-stance { color: #fca5a5; font-weight: 700; }
.dissent-stance.pos { color: #86efac; }
.dissent-stance.neg { color: #fca5a5; }
.dissent-vs { color: #475569; }

.turning-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.025);
  border-left: 2px solid #22d3ee;
  border-radius: 4px;
}
.turning-body { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.turning-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.turning-zone { color: #e6edf9; font-weight: 600; }
.turning-narr { color: #8490a8; font-size: 10.5px; letter-spacing: 1px; text-transform: capitalize; }
.turning-delta {
  font-size: 12px;
  color: #67e8f9;
  font-family: 'JetBrains Mono', monospace;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.turning-sub { color: #64748b; font-size: 10.5px; }
</style>
