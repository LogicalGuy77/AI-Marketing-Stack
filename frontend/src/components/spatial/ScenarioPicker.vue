<template>
  <div class="picker-root">
    <div class="bg-grid"></div>
    <div class="bg-glow"></div>

    <router-link to="/" class="corner-logo">
      <span class="diamond">◇</span>
      <span>MIROFISH · SPATIAL</span>
    </router-link>

    <div class="picker">
      <div class="picker-header">
        <div class="eyebrow">PHASE 01 · SELECT SCENARIO</div>
        <h2>Information Geography</h2>
        <p>
          A real-time cinematic simulation of how news spreads through a city.
          24 agents move between six zones. They only learn what others within
          walking distance tell them. Watch the lights spread.
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
          <div class="card-glow"></div>
          <div class="card-top">
            <span class="tag">ORIGIN · {{ s.origin_zones.join(' + ') }}</span>
            <span v-if="completedIds.includes(s.id)" class="done">✓ COMPLETED</span>
          </div>
          <h3>{{ s.title }}</h3>
          <p>{{ s.description }}</p>
          <div class="narratives">
            <span v-for="n in s.narratives" :key="n" class="narr-chip">{{ n }}</span>
          </div>
          <div class="cta">
            <span>RUN SIMULATION</span>
            <span class="arrow">→</span>
          </div>
        </button>
      </div>

      <div class="footer-note">
        Built with Three.js · post-processed in real-time · 50 ticks of physics &amp; belief propagation
      </div>
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
.picker-root {
  position: fixed;
  inset: 0;
  background: radial-gradient(ellipse at top, #1a1f30 0%, #05070d 70%);
  color: #e6edf9;
  font-family: 'Inter', 'SF Pro Display', -apple-system, sans-serif;
  overflow: auto;
}
.bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
  background-size: 40px 40px;
  mask-image: radial-gradient(ellipse at center, black 40%, transparent 80%);
  pointer-events: none;
}
.bg-glow {
  position: absolute;
  top: -200px;
  left: 50%;
  transform: translateX(-50%);
  width: 900px;
  height: 600px;
  background: radial-gradient(ellipse, rgba(255, 163, 70, 0.15), transparent 70%);
  pointer-events: none;
  filter: blur(40px);
}
.corner-logo {
  position: absolute;
  top: 22px;
  left: 28px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 2.5px;
  color: #e6edf9;
  text-decoration: none;
  padding: 10px 16px;
  background: rgba(10, 14, 24, 0.55);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  z-index: 3;
  transition: all 0.2s;
}
.corner-logo:hover { color: #ffc072; border-color: rgba(255, 179, 71, 0.35); }
.diamond { color: #ffa13a; font-size: 14px; }

.picker {
  position: relative;
  max-width: 1100px;
  margin: 0 auto;
  padding: 120px 32px 60px;
}
.picker-header {
  text-align: center;
  margin-bottom: 48px;
}
.eyebrow {
  display: inline-block;
  font-size: 11px;
  letter-spacing: 3.5px;
  color: #ffc072;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  margin-bottom: 18px;
  padding: 6px 14px;
  border: 1px solid rgba(255, 179, 71, 0.4);
  border-radius: 4px;
  background: rgba(255, 163, 70, 0.08);
}
.picker-header h2 {
  font-size: 54px;
  margin: 0 0 16px;
  letter-spacing: -1.2px;
  font-weight: 800;
  color: #ffffff;
  background: linear-gradient(180deg, #ffffff 30%, #8b93a8 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.picker-header p {
  color: #8b93a8;
  max-width: 620px;
  margin: 0 auto;
  line-height: 1.65;
  font-size: 14.5px;
}
.cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
  max-width: 720px;
  margin: 0 auto;
}
.card {
  position: relative;
  text-align: left;
  background: rgba(16, 20, 32, 0.6);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 28px 30px 24px;
  cursor: pointer;
  transition: transform 0.25s ease, border-color 0.25s ease;
  color: inherit;
  font: inherit;
  overflow: hidden;
}
.card-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 80% 20%, rgba(255, 163, 70, 0.14), transparent 55%);
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}
.card:hover:not(.disabled) {
  transform: translateY(-3px);
  border-color: rgba(255, 179, 71, 0.4);
}
.card:hover:not(.disabled) .card-glow { opacity: 1; }
.card.disabled { opacity: 0.45; cursor: default; }
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  position: relative;
}
.tag {
  background: rgba(255, 179, 71, 0.12);
  color: #ffc072;
  padding: 5px 11px;
  border-radius: 4px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 1.5px;
  font-family: 'JetBrains Mono', monospace;
  text-transform: uppercase;
  border: 1px solid rgba(255, 179, 71, 0.35);
}
.done {
  color: #86efac;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 1.5px;
  font-family: 'JetBrains Mono', monospace;
}
.card h3 {
  margin: 0 0 10px;
  font-size: 24px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: -0.3px;
  position: relative;
}
.card p {
  color: #94a3b8;
  font-size: 13.5px;
  line-height: 1.65;
  margin: 0 0 16px;
  position: relative;
}
.narratives { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px; position: relative; }
.narr-chip {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
}
.cta {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #ffc072;
  font-weight: 700;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: 2px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 14px;
  width: 100%;
  justify-content: space-between;
}
.arrow {
  transition: transform 0.2s ease;
  font-size: 16px;
}
.card:hover:not(.disabled) .arrow { transform: translateX(4px); }

.footer-note {
  text-align: center;
  margin-top: 48px;
  font-size: 11px;
  color: #475569;
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: 1.5px;
}
</style>
