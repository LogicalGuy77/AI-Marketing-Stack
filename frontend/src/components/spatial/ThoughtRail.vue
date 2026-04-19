<template>
  <div class="rail">
    <div class="rail-header">
      <span class="label">AGENT THOUGHTS</span>
      <span class="count">{{ thoughts.length }}</span>
    </div>
    <div class="rail-body" ref="body">
      <div v-if="thoughts.length === 0" class="empty">
        Waiting for agents to learn the news…
      </div>
      <div v-for="t in thoughts.slice().reverse()" :key="t.key" class="thought">
        <div class="meta">
          <span class="chip" :style="{ background: zoneColor(t.zone) }">{{ t.zone }}</span>
          <span class="who">{{ t.name }}</span>
          <span class="tick">T+{{ t.tick }}</span>
        </div>
        <div class="text">{{ t.text }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  thoughts: { type: Array, default: () => [] },
})

const ZONE_COLORS = {
  Government: '#1e40af',
  University: '#6b21a8',
  Market: '#b45309',
  Industrial: '#374151',
  Residential: '#065f46',
  Park: '#3f6212',
}
const zoneColor = (z) => ZONE_COLORS[z] || '#374151'
</script>

<style scoped>
.rail {
  height: 100%;
  background: #ffffff;
  border-left: 1px solid #d6dde8;
  display: flex;
  flex-direction: column;
  color: #0f172a;
}
.rail-header {
  padding: 14px 18px;
  border-bottom: 1px solid #d6dde8;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
}
.label {
  font-size: 11px;
  letter-spacing: 2.5px;
  color: #0f172a;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
}
.count {
  font-family: 'JetBrains Mono', monospace;
  color: #475569;
  font-size: 13px;
  background: #e2e8f0;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}
.rail-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.empty {
  color: #64748b;
  font-size: 13px;
  font-style: italic;
  padding: 30px 8px;
  text-align: center;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
}
.thought {
  margin-bottom: 10px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  animation: slide-in 0.25s ease;
}
@keyframes slide-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.chip {
  padding: 3px 8px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: #fff;
  letter-spacing: 0.5px;
  font-weight: 700;
}
.who {
  font-weight: 700;
  font-size: 12.5px;
  color: #0f172a;
}
.tick {
  margin-left: auto;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #64748b;
  font-weight: 600;
}
.text {
  font-size: 13px;
  line-height: 1.5;
  color: #334155;
}
</style>
