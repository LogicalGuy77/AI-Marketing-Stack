<template>
  <div class="legend" :class="{ compact }">
    <div class="legend-title">BELIEF STATE</div>
    <div class="legs">
      <div class="leg">
        <span class="dot" :style="{ background: '#64748b', boxShadow: '0 0 8px #64748b' }"></span>
        <span>Uninformed</span>
      </div>
      <div v-if="beliefLabels[0]" class="leg">
        <span class="dot" :style="{ background: '#ef4444', boxShadow: '0 0 10px #ef4444' }"></span>
        <span>{{ beliefLabels[0] }}</span>
      </div>
      <div v-if="beliefLabels[1]" class="leg">
        <span class="dot" :style="{ background: '#facc15', boxShadow: '0 0 10px #facc15' }"></span>
        <span>{{ beliefLabels[1] }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  beliefLabels: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false },
})
</script>

<style scoped>
.legend {
  background: rgba(10, 14, 24, 0.78);
  backdrop-filter: blur(14px);
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-family: 'JetBrains Mono', monospace;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
  min-width: 200px;
}
.legend.compact {
  padding: 8px 12px;
  min-width: 160px;
}
.legend-title {
  font-size: 9.5px;
  letter-spacing: 2.5px;
  font-weight: 700;
  color: #ffc072;
  margin-bottom: 8px;
}
.legs { display: flex; flex-direction: column; gap: 6px; }
.leg {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #cbd5e1;
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.3px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
</style>
