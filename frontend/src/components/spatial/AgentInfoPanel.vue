<template>
  <transition name="slide">
    <div v-if="agent" class="agent-panel">
      <div class="ap-head" :style="{ background: roleMeta.fill, color: roleMeta.text }">
        <span class="ap-glyph">{{ roleMeta.glyph }}</span>
        <div class="ap-head-text">
          <div class="ap-name">{{ agent.name }}</div>
          <div class="ap-role">{{ roleMeta.label }} · {{ agent.zone }}</div>
        </div>
        <button class="ap-close" @click="$emit('close')" aria-label="Close">×</button>
      </div>

      <div class="ap-body">
        <!-- Persona block -->
        <div v-if="persona?.bio" class="ap-row">
          <div class="ap-cell wide persona-cell">
            <div class="ap-k">PERSONA</div>
            <div class="persona-bio">{{ persona.bio }}</div>
            <div v-if="persona.ideology" class="persona-row">
              <span class="persona-label">Ideology</span>
              <span class="persona-value">{{ persona.ideology }}</span>
            </div>
            <div v-if="persona.speaking_style" class="persona-row">
              <span class="persona-label">Voice</span>
              <span class="persona-value">{{ persona.speaking_style }}</span>
            </div>
            <div v-if="persona.demographics" class="persona-row">
              <span class="persona-label">Profile</span>
              <span class="persona-value mono">
                {{ persona.demographics.age || '?' }} ·
                {{ persona.demographics.gender || '?' }} ·
                {{ persona.demographics.mbti || '?' }}
              </span>
            </div>
            <div v-if="persona.values?.length" class="persona-row">
              <span class="persona-label">Values</span>
              <span class="persona-chips">
                <span v-for="v in persona.values" :key="v" class="vchip">{{ v }}</span>
              </span>
            </div>
            <div class="persona-row persona-meta">
              <span class="persona-label">Influence</span>
              <span class="persona-meter">
                <span class="meter-fill" :style="{ width: ((persona.influence || 1) / 3) * 100 + '%' }"></span>
              </span>
              <span class="mono meter-val">{{ (persona.influence || 1).toFixed(1) }}×</span>
            </div>
            <div class="persona-row persona-meta">
              <span class="persona-label">Openness</span>
              <span class="persona-meter">
                <span class="meter-fill warm" :style="{ width: ((persona.susceptibility || 1) / 1.5) * 100 + '%' }"></span>
              </span>
              <span class="mono meter-val">{{ (persona.susceptibility || 1).toFixed(1) }}</span>
            </div>
          </div>
        </div>

        <!-- Stance bars -->
        <div v-if="stanceEntries.length" class="ap-row">
          <div class="ap-cell wide">
            <div class="ap-k">OPINION SPECTRUM</div>
            <div class="stance-bars">
              <div v-for="e in stanceEntries" :key="e.key" class="stance-row">
                <div class="stance-label">
                  <span class="stance-title">{{ e.label }}</span>
                  <span class="stance-value mono" :style="{ color: e.textColor }">{{ e.valueStr }}</span>
                </div>
                <div class="stance-track">
                  <div class="stance-tick-zero"></div>
                  <div class="stance-fill"
                       :style="{ left: e.fillLeft, width: e.fillWidth, background: e.color }"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="ap-row">
          <div class="ap-cell">
            <div class="ap-k">STATUS</div>
            <div class="ap-v">
              <span class="ap-pill" :class="agent.knows ? 'pill-info' : 'pill-dark'">
                <span class="pill-dot" :style="{ background: beliefDotColor }"></span>
                {{ agent.knows ? 'INFORMED' : 'UNINFORMED' }}
              </span>
            </div>
          </div>
          <div class="ap-cell">
            <div class="ap-k">LEARNED AT</div>
            <div class="ap-v mono">
              {{ agent.learned_at_tick != null ? 'T' + String(agent.learned_at_tick).padStart(2, '0') : '—' }}
            </div>
          </div>
        </div>

        <div v-if="agent.last_thought" class="ap-row">
          <div class="ap-cell wide">
            <div class="ap-k">LAST THOUGHT</div>
            <div class="ap-thought">"{{ agent.last_thought }}"</div>
          </div>
        </div>

        <!-- Interview -->
        <div class="ap-row">
          <div class="ap-cell wide interview-cell">
            <div class="ap-k interview-head">
              <span>ASK {{ (agent.name || '').toUpperCase() }}</span>
              <span v-if="interviewLoading" class="interview-pulse"></span>
            </div>
            <form class="interview-form" @submit.prevent="submitInterview">
              <input
                v-model="question"
                class="interview-input"
                type="text"
                placeholder="Ask a question…"
                :disabled="interviewLoading"
              />
              <button
                type="submit"
                class="interview-btn"
                :disabled="!question.trim() || interviewLoading"
              >ASK</button>
            </form>
            <div v-if="interviewError" class="interview-error">{{ interviewError }}</div>
            <div v-if="interviewExchanges.length" class="interview-log">
              <div v-for="(ex, i) in interviewExchanges" :key="i" class="interview-exchange">
                <div class="interview-q">→ {{ ex.question }}</div>
                <div class="interview-a">{{ ex.answer }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="ap-row">
          <div class="ap-cell">
            <div class="ap-k">POSITION</div>
            <div class="ap-v mono">{{ agent.x.toFixed(1) }}, {{ agent.y.toFixed(1) }}</div>
          </div>
          <div class="ap-cell">
            <div class="ap-k">ID</div>
            <div class="ap-v mono">{{ agent.id }}</div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { interviewAgent } from '../../api/spatial.js'

const props = defineProps({
  agent: { type: Object, default: null },
  narratives: { type: Object, default: () => ({}) },
  simId: { type: String, default: null },
})
defineEmits(['close'])

const persona = computed(() => props.agent?.persona || null)

const NARRATIVE_COLORS = ['#ef4444', '#facc15', '#3b82f6', '#10b981', '#a855f7']

const stanceEntries = computed(() => {
  const stances = props.agent?.stances
  if (!stances || typeof stances !== 'object') return []
  const keys = Object.keys(stances)
  return keys.map((k, idx) => {
    const v = Number(stances[k]) || 0
    const narrText = props.narratives?.[k] || ''
    const color = NARRATIVE_COLORS[idx % NARRATIVE_COLORS.length]
    const pct = Math.min(1, Math.abs(v))
    const fillWidth = (pct * 50).toFixed(2) + '%'
    const fillLeft = v >= 0 ? '50%' : (50 - pct * 50).toFixed(2) + '%'
    return {
      key: k,
      label: k.replace(/_/g, ' '),
      narrative: narrText,
      value: v,
      valueStr: (v >= 0 ? '+' : '') + v.toFixed(2),
      color,
      textColor: color,
      fillLeft,
      fillWidth,
    }
  })
})

// Interview state — reset when agent changes
const question = ref('')
const interviewExchanges = ref([])
const interviewLoading = ref(false)
const interviewError = ref('')

watch(() => props.agent?.id, () => {
  question.value = ''
  interviewExchanges.value = []
  interviewError.value = ''
  interviewLoading.value = false
})

async function submitInterview() {
  if (!props.agent?.id || !props.simId) {
    interviewError.value = 'Simulation not ready yet.'
    return
  }
  const q = question.value.trim()
  if (!q) return
  interviewError.value = ''
  interviewLoading.value = true
  const pending = { question: q, answer: '…' }
  interviewExchanges.value = [...interviewExchanges.value, pending]
  try {
    const resp = await interviewAgent(props.simId, props.agent.id, q)
    pending.answer = resp?.answer || '(empty response)'
    interviewExchanges.value = [...interviewExchanges.value]
    question.value = ''
  } catch (e) {
    pending.answer = ''
    interviewError.value = e?.response?.data?.error || e.message || 'Interview failed'
    interviewExchanges.value = [...interviewExchanges.value]
  } finally {
    interviewLoading.value = false
  }
}

const ROLE_META = {
  official:   { glyph: '★', label: 'GOVERNMENT',  fill: '#1e3a8a', text: '#ffffff' },
  student:    { glyph: '✎', label: 'STUDENT',     fill: '#7e22ce', text: '#ffffff' },
  vendor:     { glyph: '⚖', label: 'VENDOR',      fill: '#b45309', text: '#ffffff' },
  worker:     { glyph: '⚒', label: 'WORKER',      fill: '#374151', text: '#ffffff' },
  citizen:    { glyph: '◉', label: 'CITIZEN',     fill: '#047857', text: '#ffffff' },
  visitor:    { glyph: '✈', label: 'VISITOR',     fill: '#4d7c0f', text: '#ffffff' },
  journalist: { glyph: '◎', label: 'JOURNALIST',  fill: '#0f172a', text: '#fbbf24' },
}

const roleMeta = computed(() => ROLE_META[props.agent?.archetype] || {
  glyph: '?', label: 'UNKNOWN', fill: '#475569', text: '#ffffff',
})

const beliefDotColor = computed(() => {
  if (!props.agent?.knows) return '#475569'
  // First-listed narrative => red, second => amber
  const keys = Object.keys(props.narratives || {})
  if (keys.length >= 2 && props.agent.belief === keys[1]) return '#facc15'
  return '#ef4444'
})

const beliefText = computed(() => {
  if (!props.agent?.belief) return null
  return props.narratives?.[props.agent.belief] || null
})
</script>

<style scoped>
.agent-panel {
  width: 100%;
  background: rgba(10, 14, 24, 0.88);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  font-family: 'Inter', -apple-system, sans-serif;
  color: #e6edf9;
}
.ap-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
}
.ap-glyph {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 700;
}
.ap-head-text { flex: 1; min-width: 0; }
.ap-name {
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-role {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  letter-spacing: 1.6px;
  font-weight: 700;
  opacity: 0.85;
  margin-top: 3px;
}
.ap-close {
  background: rgba(255, 255, 255, 0.15);
  color: inherit;
  border: none;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ap-close:hover { background: rgba(255, 255, 255, 0.3); }
.ap-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: rgba(255, 255, 255, 0.02);
}
.ap-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.ap-cell.wide { grid-column: 1 / -1; }
.ap-cell {
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 9px 11px;
}
.ap-k {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px;
  letter-spacing: 1.6px;
  color: #ffc072;
  font-weight: 700;
  margin-bottom: 5px;
}
.ap-v { font-size: 13px; color: #e6edf9; font-weight: 600; }
.mono { font-family: 'JetBrains Mono', monospace; }
.ap-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  letter-spacing: 0.8px;
}
.pill-info { background: rgba(22, 163, 74, 0.15); color: #86efac; border: 1px solid rgba(22, 163, 74, 0.4); }
.pill-dark { background: rgba(255, 255, 255, 0.05); color: #94a3b8; border: 1px solid rgba(255, 255, 255, 0.08); }
.pill-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; box-shadow: 0 0 8px currentColor; }
.ap-belief {
  border-left: 3px solid #ef4444;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
}
.ap-belief-key {
  font-size: 10.5px;
  color: #94a3b8;
  letter-spacing: 0.6px;
  margin-bottom: 4px;
}
.ap-belief-text {
  font-size: 12.5px;
  color: #cbd5e1;
  font-style: italic;
  line-height: 1.5;
}
.ap-thought {
  font-size: 12.5px;
  color: #fde68a;
  font-style: italic;
  line-height: 1.55;
  background: rgba(234, 88, 12, 0.1);
  border: 1px solid rgba(234, 88, 12, 0.3);
  border-radius: 6px;
  padding: 10px 12px;
}

.slide-enter-active, .slide-leave-active {
  transition: transform 220ms ease, opacity 220ms ease;
}
.slide-enter-from, .slide-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

/* Persona block */
.persona-cell { display: flex; flex-direction: column; gap: 8px; }
.persona-bio {
  font-size: 13px;
  line-height: 1.55;
  color: #e6edf9;
  font-style: italic;
}
.persona-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: #cbd5e1;
}
.persona-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px;
  letter-spacing: 1.4px;
  color: #8490a8;
  font-weight: 700;
  min-width: 68px;
}
.persona-value { color: #e6edf9; font-size: 12px; }
.persona-chips { display: flex; gap: 4px; flex-wrap: wrap; }
.vchip {
  background: rgba(255, 179, 71, 0.12);
  color: #ffc072;
  border: 1px solid rgba(255, 179, 71, 0.35);
  padding: 2px 7px;
  border-radius: 3px;
  font-size: 10.5px;
  font-family: 'JetBrains Mono', monospace;
}
.persona-meta { gap: 10px; }
.persona-meter {
  flex: 1;
  height: 5px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}
.meter-fill { display: block; height: 100%; background: linear-gradient(90deg, #3b82f6, #a855f7); }
.meter-fill.warm { background: linear-gradient(90deg, #f59e0b, #ef4444); }
.meter-val { color: #ffc072; font-size: 11px; min-width: 30px; text-align: right; }

/* Stance bars */
.stance-bars { display: flex; flex-direction: column; gap: 10px; }
.stance-row { display: flex; flex-direction: column; gap: 4px; }
.stance-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.stance-title {
  font-size: 11.5px;
  color: #e6edf9;
  letter-spacing: 0.2px;
  text-transform: capitalize;
}
.stance-value { font-size: 11px; font-weight: 700; }
.stance-track {
  position: relative;
  height: 7px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  overflow: hidden;
}
.stance-tick-zero {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.2);
  transform: translateX(-50%);
}
.stance-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 3px;
  box-shadow: 0 0 8px currentColor;
}

/* Interview */
.interview-cell { display: flex; flex-direction: column; gap: 8px; }
.interview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #ffc072;
}
.interview-pulse {
  width: 8px; height: 8px; border-radius: 50%;
  background: #ffc072;
  animation: ipulse 1.1s ease-in-out infinite;
}
@keyframes ipulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.interview-form {
  display: flex;
  gap: 6px;
}
.interview-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 8px 10px;
  color: #e6edf9;
  font-family: inherit;
  font-size: 12.5px;
  outline: none;
  transition: border-color 0.15s;
}
.interview-input:focus { border-color: rgba(255, 179, 71, 0.6); }
.interview-input:disabled { opacity: 0.5; }
.interview-btn {
  background: linear-gradient(180deg, #ffb347, #ea580c);
  color: #0a0e18;
  border: 0;
  border-radius: 6px;
  padding: 8px 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.2px;
  cursor: pointer;
  transition: transform 0.1s;
}
.interview-btn:hover:not(:disabled) { transform: scale(1.04); }
.interview-btn:disabled { background: rgba(255, 255, 255, 0.05); color: #475569; cursor: not-allowed; }
.interview-error {
  font-size: 11px;
  color: #fca5a5;
  font-style: italic;
}
.interview-log { display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto; }
.interview-log::-webkit-scrollbar { width: 4px; }
.interview-log::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); }
.interview-exchange {
  background: rgba(255, 255, 255, 0.035);
  border-left: 2px solid rgba(255, 179, 71, 0.4);
  padding: 7px 10px;
  border-radius: 4px;
}
.interview-q {
  font-size: 11px;
  color: #ffc072;
  font-family: 'JetBrains Mono', monospace;
  margin-bottom: 4px;
}
.interview-a {
  font-size: 12.5px;
  color: #e6edf9;
  line-height: 1.5;
  font-style: italic;
}
</style>
