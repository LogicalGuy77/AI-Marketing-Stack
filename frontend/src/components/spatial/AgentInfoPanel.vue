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
              {{ agent.learned_at_tick != null ? 'tick ' + agent.learned_at_tick : '—' }}
            </div>
          </div>
        </div>

        <div v-if="agent.belief" class="ap-row">
          <div class="ap-cell wide">
            <div class="ap-k">BELIEF</div>
            <div class="ap-belief" :style="{ borderLeftColor: beliefDotColor }">
              <div class="ap-belief-key mono">{{ agent.belief }}</div>
              <div v-if="beliefText" class="ap-belief-text">"{{ beliefText }}"</div>
            </div>
          </div>
        </div>

        <div v-if="agent.last_thought" class="ap-row">
          <div class="ap-cell wide">
            <div class="ap-k">LAST THOUGHT</div>
            <div class="ap-thought">"{{ agent.last_thought }}"</div>
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
import { computed } from 'vue'

const props = defineProps({
  agent: { type: Object, default: null },
  narratives: { type: Object, default: () => ({}) },
})
defineEmits(['close'])

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
</style>
