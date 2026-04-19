<template>
  <div class="picker">
    <div class="picker-header">
      <div class="eyebrow">PHASE 01 · SELECT SCENARIO</div>
      <h2>Information Geography</h2>
      <p>
        Pick a reality to simulate. Agents are placed in six city zones and
        can only learn news from others they physically walk near.
      </p>
    </div>
    <div class="cards">
      <button
        v-for="s in scenarios"
        :key="s.id"
        class="card"
        :class="{ disabled: completedIds.includes(s.id) }"
        :disabled="completedIds.includes(s.id)"
        @click="$emit('pick', s.id)"
      >
        <div class="card-top">
          <span class="tag">{{ s.origin_zones.join(' + ') }}</span>
          <span v-if="completedIds.includes(s.id)" class="done">✓ DONE</span>
        </div>
        <h3>{{ s.title }}</h3>
        <p>{{ s.description }}</p>
        <div class="narratives">
          <span v-for="n in s.narratives" :key="n" class="narr-chip">{{ n }}</span>
        </div>
        <div class="cta">Run Simulation →</div>
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  scenarios: { type: Array, required: true },
  completedIds: { type: Array, default: () => [] },
})
defineEmits(['pick'])
</script>

<style scoped>
.picker {
  max-width: 1100px;
  margin: 0 auto;
  padding: 40px 24px;
  color: #0f172a;
}
.picker-header {
  text-align: center;
  margin-bottom: 36px;
}
.eyebrow {
  font-size: 12px;
  letter-spacing: 3px;
  color: #2563eb;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  margin-bottom: 12px;
}
.picker-header h2 {
  font-size: 38px;
  margin: 0 0 10px;
  letter-spacing: -0.5px;
  font-weight: 800;
  color: #0f172a;
}
.picker-header p {
  color: #475569;
  max-width: 640px;
  margin: 0 auto;
  line-height: 1.55;
}
.cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}
.card {
  position: relative;
  text-align: left;
  background: #ffffff;
  border: 1px solid #d6dde8;
  border-radius: 16px;
  padding: 26px 26px 22px;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  color: inherit;
  font: inherit;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
}
.card:hover:not(.disabled) {
  transform: translateY(-2px);
  border-color: #2563eb;
  box-shadow: 0 18px 40px -20px rgba(37, 99, 235, 0.4);
}
.card.disabled { opacity: 0.55; cursor: default; }
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.tag {
  background: #dbeafe;
  color: #1d4ed8;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1px;
  font-family: 'JetBrains Mono', monospace;
  text-transform: uppercase;
}
.done {
  color: #16a34a;
  font-weight: 700;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
}
.card h3 {
  margin: 0 0 10px;
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
}
.card p {
  color: #475569;
  font-size: 14px;
  line-height: 1.55;
  margin: 0 0 14px;
}
.narratives { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.narr-chip {
  background: #f1f5f9;
  border: 1px solid #d6dde8;
  color: #334155;
  padding: 3px 9px;
  border-radius: 4px;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
}
.cta {
  color: #2563eb;
  font-weight: 700;
  font-size: 14px;
}
</style>
