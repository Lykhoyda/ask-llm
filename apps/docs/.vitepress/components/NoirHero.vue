<template>
  <section class="noir-hero">
    <p class="command">
      <span class="visually-hidden">claude mcp add ask-llm -- npx -y ask-llm-mcp</span>
      <span aria-hidden="true">$ {{ typed }}</span><span class="cursor" aria-hidden="true">▌</span>
    </p>
    <h1>Every diff deserves<br />a second opinion.</h1>
    <p class="sub">
      Your coding agent consults another frontier model over MCP. Independent
      reviews, plan debates, fresh eyes.
    </p>
    <p class="ctas">
      <a class="cta primary" :href="withBase('/getting-started')">Quick Start</a>
      <a class="cta alt" :href="withBase('/plugin/overview')">Install Plugin</a>
    </p>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { withBase } from "vitepress";

const FULL = "claude mcp add ask-llm -- npx -y ask-llm-mcp";
const typed = ref("");
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    typed.value = FULL;
    return;
  }
  let i = 0;
  timer = setInterval(() => {
    i += 1;
    typed.value = FULL.slice(0, i);
    if (i >= FULL.length) clearInterval(timer);
  }, 35);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<style scoped>
.noir-hero {
  padding: var(--space-16) 0 var(--space-12);
  max-width: 760px;
}
.command {
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--accent);
  min-height: 1.5em;
  margin: 0 0 var(--space-4);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.cursor { animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
h1 {
  font-family: var(--font-mono);
  font-size: clamp(32px, 5vw, 52px);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
  margin: 0 0 var(--space-4);
  border: none;
}
.sub {
  font-family: var(--font-sans);
  color: var(--noir-text-2);
  font-size: 16px;
  max-width: 52ch;
  margin: 0 0 var(--space-6);
}
.ctas { display: flex; gap: var(--space-3); margin: 0; }
.cta {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  padding: 10px 18px;
  border-radius: var(--radius);
  text-decoration: none;
  transition: transform 0.1s ease;
}
.cta:active { transform: translateY(1px); }
.cta.primary { background: var(--accent); color: var(--noir-bg); }
.cta.primary:hover { background: var(--accent-dim); }
.cta.alt { border: 1px solid var(--noir-border-strong); color: var(--noir-text); }
.cta.alt:hover { border-color: var(--accent); }
@media (prefers-reduced-motion: reduce) {
  .cursor { animation: none; }
}
@media (max-width: 640px) {
  .noir-hero { padding-top: var(--space-8); }
  .ctas { flex-direction: column; }
}
</style>
