<template>
  <div class="spatial-root">
    <header class="topbar">
      <router-link to="/" class="logo">◇ MIROFISH · SPATIAL</router-link>
      <div class="topbar-right">
        <span class="status-dot" :class="phase"></span>
        <span class="phase-label">{{ phaseLabel }}</span>
      </div>
    </header>

    <!-- PHASE 1: pick -->
    <ScenarioPicker
      v-if="phase === 'pick'"
      :scenarios="scenarios"
      :completed-ids="completedIds"
      @pick="startScenario"
    />

    <!-- PHASE 2: live run -->
    <div v-else-if="phase === 'running'" class="run-shell">
      <div class="run-hud">
        <div class="hud-card">
          <div class="hud-label">SCENARIO</div>
          <div class="hud-value">{{ currentScenario?.title }}</div>
        </div>
        <div class="hud-card">
          <div class="hud-label">TICK</div>
          <div class="hud-value mono">{{ currentTick }} / {{ totalTicks }}</div>
        </div>
        <div class="hud-card">
          <div class="hud-label">AGENTS INFORMED</div>
          <div class="hud-value mono">{{ informedCount }} / {{ totalAgents }}</div>
        </div>
        <div class="hud-card progress-card">
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
          </div>
        </div>
      </div>

      <div class="run-body">
        <div class="scene-wrap">
          <canvas ref="canvasRef"></canvas>
          <SceneLegend :belief-labels="beliefLabels" />
          <div class="scene-hint">Click any agent · drag to orbit · scroll to zoom</div>
          <AgentInfoPanel
            :agent="selectedAgent"
            :narratives="narrativeMap"
            @close="closeAgentPanel"
          />
        </div>
        <aside class="rail-wrap">
          <ThoughtRail :thoughts="thoughts" />
        </aside>
      </div>
    </div>

    <!-- PHASE 3: comparison -->
    <div v-else-if="phase === 'compare'" class="compare-shell">
      <div class="compare-hud">
        <h2>Side-by-Side: Information Geography</h2>
        <div class="tick-control">
          <span class="t-lbl">TICK</span>
          <input
            type="range"
            min="0"
            :max="totalTicks"
            v-model.number="compareTick"
            class="slider"
          />
          <span class="t-val mono">{{ compareTick }} / {{ totalTicks }}</span>
        </div>
      </div>
      <div class="compare-scenes">
        <div class="compare-scene">
          <div class="scene-title">{{ runs[0]?.scenario?.title }}</div>
          <canvas ref="canvasA"></canvas>
          <SceneLegend :belief-labels="runs[0]?.scenario?.narratives || []" compact />
          <AgentInfoPanel
            :agent="selectedAgentA"
            :narratives="runs[0]?.scenario?.narrative_map || {}"
            @close="selectedAgentA = null"
          />
        </div>
        <div class="compare-scene">
          <div class="scene-title">{{ runs[1]?.scenario?.title }}</div>
          <canvas ref="canvasB"></canvas>
          <SceneLegend :belief-labels="runs[1]?.scenario?.narratives || []" compact />
          <AgentInfoPanel
            :agent="selectedAgentB"
            :narratives="runs[1]?.scenario?.narrative_map || {}"
            @close="selectedAgentB = null"
          />
        </div>
      </div>
      <div class="compare-reports">
        <div v-for="(r, i) in runs" :key="i" class="report-card">
          <div class="rc-title">
            <span class="chip" :class="'chip-' + i">{{ i === 0 ? 'A' : 'B' }}</span>
            {{ r.scenario.title }}
          </div>
          <pre class="rc-body">{{ r.report?.narrative || 'Report loading…' }}</pre>
        </div>
      </div>
      <div class="compare-actions">
        <button class="btn-primary" @click="resetAll">Run Again</button>
        <router-link to="/" class="btn-secondary">Back to Home</router-link>
      </div>
    </div>

    <div v-else class="loader">Loading scenarios…</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { CityScene } from '../components/spatial/CityScene.js'
import ScenarioPicker from '../components/spatial/ScenarioPicker.vue'
import ThoughtRail from '../components/spatial/ThoughtRail.vue'
import AgentInfoPanel from '../components/spatial/AgentInfoPanel.vue'
import SceneLegend from '../components/spatial/SceneLegend.vue'
import {
  getSpatialScenarios,
  startSpatialSim,
  getSpatialState,
  getSpatialReport,
} from '../api/spatial.js'

const phase = ref('pick') // pick | running | compare
const scenarios = ref([])
const zones = ref([])
const grid = ref({ w: 60, h: 40 })
const totalTicks = ref(50)

const currentScenario = ref(null)
const currentSimId = ref(null)
const currentTick = ref(0)
const snapshotsByTick = ref(new Map())
const thoughts = ref([])
const agentIndex = ref(new Map()) // id -> {name, zone}

const canvasRef = ref(null)
let scene = null

const runs = ref([]) // [{scenario, snapshotsByTick, agentIndex, report}]
const completedIds = computed(() => runs.value.map((r) => r.scenario.id))

const canvasA = ref(null)
const canvasB = ref(null)
let sceneA = null
let sceneB = null
const compareTick = ref(0)

const selectedAgent = ref(null)
const selectedAgentA = ref(null)
const selectedAgentB = ref(null)

let pollHandle = null

const phaseLabel = computed(() => {
  if (phase.value === 'pick') return 'Awaiting selection'
  if (phase.value === 'running') return `Running · ${currentScenario.value?.title ?? ''}`
  if (phase.value === 'compare') return 'Comparison ready'
  return '—'
})

const totalAgents = computed(() => {
  const snap = snapshotsByTick.value.get(currentTick.value)
  return snap?.agents?.length ?? 0
})
const informedCount = computed(() => {
  const snap = snapshotsByTick.value.get(currentTick.value)
  if (!snap) return 0
  return snap.agents.filter((a) => a.knows).length
})
const progressPct = computed(() => Math.round((currentTick.value / totalTicks.value) * 100))
const beliefLabels = computed(() => currentScenario.value?.narratives ?? [])
const narrativeMap = computed(() => currentScenario.value?.narrative_map ?? {})

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
  phase.value = 'running'

  const resp = await startSpatialSim(scenarioId)
  currentSimId.value = resp.simulation_id

  await nextTick()
  if (scene) scene.dispose()
  selectedAgent.value = null
  scene = new CityScene()
  scene.init(canvasRef.value, grid.value, zones.value)
  scene.onAgentSelect = (a) => { selectedAgent.value = a }

  pollLoop()
}

function closeAgentPanel() {
  selectedAgent.value = null
  if (scene) {
    scene.selectedId = null
    scene._refreshSelectionRing?.()
  }
}

async function pollLoop() {
  if (!currentSimId.value) return
  try {
    const latestTick = currentTick.value
    const data = await getSpatialState(currentSimId.value, latestTick)
    for (const snap of data.snapshots) {
      snapshotsByTick.value.set(snap.tick, snap)
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
      currentTick.value = snap.tick
      scene?.setState(snap, currentScenario.value?.narratives ?? [])
      if (selectedAgent.value) {
        const fresh = snap.agents.find((a) => a.id === selectedAgent.value.id)
        if (fresh) selectedAgent.value = fresh
      }
    }

    if (data.status === 'done' && data.latest_tick >= totalTicks.value) {
      // Finalize this run
      const report = await getSpatialReport(currentSimId.value)
      runs.value.push({
        scenario: currentScenario.value,
        snapshotsByTick: snapshotsByTick.value,
        agentIndex: agentIndex.value,
        report,
      })
      if (runs.value.length >= 2) {
        await transitionToCompare()
      } else {
        // Return to pick to choose the second scenario
        phase.value = 'pick'
        if (scene) { scene.dispose(); scene = null }
      }
      return
    }
  } catch (e) {
    console.error('Spatial poll error', e)
  }
  pollHandle = setTimeout(pollLoop, 500)
}

async function transitionToCompare() {
  if (pollHandle) clearTimeout(pollHandle)
  if (scene) { scene.dispose(); scene = null }
  phase.value = 'compare'
  compareTick.value = totalTicks.value
  await nextTick()
  selectedAgentA.value = null
  selectedAgentB.value = null
  sceneA = new CityScene()
  sceneA.init(canvasA.value, grid.value, zones.value)
  sceneA.onAgentSelect = (a) => { selectedAgentA.value = a }
  sceneB = new CityScene()
  sceneB.init(canvasB.value, grid.value, zones.value)
  sceneB.onAgentSelect = (a) => { selectedAgentB.value = a }
  renderCompareTick(compareTick.value)
}

function renderCompareTick(tick) {
  const [a, b] = runs.value
  if (!a || !b) return
  const snapA = a.snapshotsByTick.get(tick) || lastTickSnap(a.snapshotsByTick, tick)
  const snapB = b.snapshotsByTick.get(tick) || lastTickSnap(b.snapshotsByTick, tick)
  if (snapA) sceneA?.setState(snapA, a.scenario.narratives)
  if (snapB) sceneB?.setState(snapB, b.scenario.narratives)
  if (selectedAgentA.value && snapA) {
    const fresh = snapA.agents.find((x) => x.id === selectedAgentA.value.id)
    if (fresh) selectedAgentA.value = fresh
  }
  if (selectedAgentB.value && snapB) {
    const fresh = snapB.agents.find((x) => x.id === selectedAgentB.value.id)
    if (fresh) selectedAgentB.value = fresh
  }
}

function lastTickSnap(map, tick) {
  let best = null
  for (const [k, v] of map) {
    if (k <= tick && (!best || k > best.tick)) best = v
  }
  return best
}

watch(compareTick, (t) => renderCompareTick(t))

async function resetAll() {
  runs.value = []
  compareTick.value = 0
  if (sceneA) { sceneA.dispose(); sceneA = null }
  if (sceneB) { sceneB.dispose(); sceneB = null }
  phase.value = 'pick'
}

onMounted(async () => {
  await loadScenarios()
})

onBeforeUnmount(() => {
  if (pollHandle) clearTimeout(pollHandle)
  if (scene) scene.dispose()
  if (sceneA) sceneA.dispose()
  if (sceneB) sceneB.dispose()
})
</script>

<style scoped>
.spatial-root {
  min-height: 100vh;
  background: #f5f7fb;
  color: #0f172a;
  font-family: 'Inter', -apple-system, sans-serif;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 28px;
  border-bottom: 1px solid #d6dde8;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(8px);
}
.logo {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  letter-spacing: 2.5px;
  font-size: 14px;
  color: #0f172a;
  text-decoration: none;
}
.topbar-right { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #475569; font-family: 'JetBrains Mono', monospace; }
.status-dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: #94a3b8;
}
.status-dot.pick { background: #94a3b8; }
.status-dot.running { background: #ea580c; animation: pulse 1.2s infinite; box-shadow: 0 0 0 0 rgba(234, 88, 12, 0.4); }
.status-dot.compare { background: #16a34a; }
@keyframes pulse {
  0%, 100% { opacity: 1; } 50% { opacity: 0.35; }
}

/* Run phase */
.run-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 14px;
}
.run-hud {
  display: grid;
  grid-template-columns: repeat(3, minmax(180px, 1fr)) 2fr;
  gap: 12px;
}
.hud-card {
  background: #ffffff;
  border: 1px solid #d6dde8;
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.hud-label {
  font-size: 10.5px;
  letter-spacing: 2.2px;
  color: #64748b;
  font-family: 'JetBrains Mono', monospace;
  margin-bottom: 6px;
  font-weight: 700;
}
.hud-value { font-weight: 700; font-size: 17px; color: #0f172a; }
.mono { font-family: 'JetBrains Mono', monospace; }
.progress-card { display: flex; align-items: center; }
.progress-track { flex: 1; height: 10px; background: #e2e8f0; border-radius: 5px; overflow: hidden; }
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #2563eb, #16a34a);
  transition: width 0.3s ease;
}
.run-body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 14px;
  min-height: 0;
}
.scene-wrap {
  position: relative;
  background: #ffffff;
  border: 1px solid #d6dde8;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}
.scene-wrap canvas { width: 100%; height: 100%; display: block; }
.legend {
  position: absolute;
  bottom: 12px; left: 12px;
  display: flex;
  gap: 10px;
  background: rgba(255, 255, 255, 0.95);
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid #d6dde8;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
}
.leg { display: flex; align-items: center; gap: 6px; color: #334155; font-weight: 600; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.rail-wrap {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #d6dde8;
  background: #ffffff;
}

/* Compare phase */
.compare-shell {
  flex: 1;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.compare-hud {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
}
.compare-hud h2 { margin: 0; font-size: 22px; letter-spacing: -0.3px; color: #0f172a; }
.tick-control {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #ffffff;
  border: 1px solid #d6dde8;
  border-radius: 10px;
  padding: 10px 16px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.t-lbl { font-size: 11px; letter-spacing: 2px; color: #64748b; font-family: 'JetBrains Mono', monospace; font-weight: 700; }
.t-val { color: #0f172a; font-size: 14px; font-weight: 600; }
.slider {
  width: 280px;
  accent-color: #2563eb;
}
.compare-scenes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  height: 440px;
}
.compare-scene {
  position: relative;
  background: #ffffff;
  border: 1px solid #d6dde8;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}
.compare-scene canvas { width: 100%; height: 100%; display: block; }
.scene-title {
  position: absolute;
  top: 12px; left: 12px;
  background: rgba(255, 255, 255, 0.95);
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #d6dde8;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  letter-spacing: 1px;
  color: #0f172a;
  font-weight: 600;
  z-index: 1;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}
.compare-reports {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.report-card {
  background: #ffffff;
  border: 1px solid #d6dde8;
  border-radius: 12px;
  padding: 18px 20px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
}
.rc-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 10px;
  color: #0f172a;
}
.chip {
  width: 24px; height: 24px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 12px;
}
.chip-0 { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
.chip-1 { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
.rc-body {
  white-space: pre-wrap;
  font-family: 'Inter', sans-serif;
  color: #334155;
  font-size: 13.5px;
  line-height: 1.6;
  margin: 0;
}
.compare-actions { display: flex; gap: 10px; }
.btn-primary, .btn-secondary {
  padding: 10px 18px;
  border-radius: 8px;
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
  text-decoration: none;
  font-size: 14px;
}
.btn-primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.btn-primary:hover { background: #1d4ed8; }
.btn-secondary {
  background: #ffffff;
  color: #334155;
  border-color: #d6dde8;
}
.btn-secondary:hover { border-color: #2563eb; color: #2563eb; }

.loader {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1;
  color: #64748b;
  font-family: 'JetBrains Mono', monospace;
}
</style>
