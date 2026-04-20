<template>
  <div class="cinema-root">
    <!-- PHASE 1: picker -->
    <ScenarioPicker
      v-if="phase === 'pick'"
      :scenarios="scenarios"
      :completed-ids="[]"
      @pick="startScenario"
    />

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

      <!-- Scene legend overlay (bottom-left) -->
      <div class="legend-wrap">
        <SceneLegend :belief-labels="beliefLabels" />
      </div>

      <!-- Agent info panel (left drawer) -->
      <div class="agent-panel-wrap">
        <AgentInfoPanel
          :agent="selectedAgent"
          :narratives="narrativeMap"
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
            <div v-if="report?.narrative" class="drawer-summary">{{ report.narrative }}</div>
            <div v-else class="drawer-pending">
              <span class="pulse"></span>
              The simulation is still running. The debrief will synthesize once all {{ totalTicks }} ticks complete.
            </div>
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
import SceneLegend from '../components/spatial/SceneLegend.vue'
import {
  getSpatialScenarios,
  startSpatialSim,
  getSpatialState,
  getSpatialReport,
} from '../api/spatial.js'

const phase = ref('pick') // pick | play
const scenarios = ref([])
const zones = ref([])
const grid = ref({ w: 60, h: 40 })
const totalTicks = ref(50)

const currentScenario = ref(null)
const currentSimId = ref(null)
const simStatus = ref('loading') // loading | done

const snapshotsByTick = ref(new Map())
const loadedMaxTick = ref(-1)
const currentTick = ref(0)

const thoughts = ref([])
const agentIndex = ref(new Map())

const report = ref(null)

const isPlaying = ref(true)
const speeds = [0.5, 1, 2, 4]
const playSpeed = ref(1)
const BASE_TICKS_PER_SECOND = 5

const drawerOpen = ref(true)

const canvasRef = ref(null)
let scene = null
let pollHandle = null
let rafHandle = null
let lastFrameTs = 0
let tickAccumulator = 0

const selectedAgent = ref(null)

const ZONE_COLORS = {
  Government: '#3b82f6',
  University: '#a855f7',
  Market: '#f59e0b',
  Industrial: '#64748b',
  Residential: '#10b981',
  Park: '#84cc16',
}
const zoneColor = (z) => ZONE_COLORS[z] || '#94a3b8'

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
const loadedPct = computed(() => totalTicks.value ? Math.max(0, (loadedMaxTick.value / totalTicks.value) * 100) : 0)
const playedPct = computed(() => totalTicks.value ? (currentTick.value / totalTicks.value) * 100 : 0)
const beliefLabels = computed(() => currentScenario.value?.narratives ?? [])
const narrativeMap = computed(() => currentScenario.value?.narrative_map ?? {})
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
}

onMounted(async () => {
  await loadScenarios()
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
.legend-wrap {
  position: absolute;
  bottom: 110px;
  left: 24px;
  z-index: 2;
}

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
</style>
