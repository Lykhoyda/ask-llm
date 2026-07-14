<template>
  <figure ref="root" class="noir-diagram">
    <svg
      viewBox="0 0 640 240"
      role="img"
      aria-label="Diagram: one prompt fans out to several providers in parallel and each response returns independently."
      :class="{ run: inView }"
    >
      <g class="node source">
        <rect x="8" y="98" width="180" height="44" rx="4" />
        <text x="98" y="124">multi-llm</text>
      </g>

      <line class="beam b0" x1="188" y1="120" x2="452" y2="30" />
      <line class="beam b1" x1="188" y1="120" x2="452" y2="90" />
      <line class="beam b2" x1="188" y1="120" x2="452" y2="150" />
      <line class="beam b3" x1="188" y1="120" x2="452" y2="210" />

      <g class="node target t0 codex">
        <rect x="452" y="8" width="180" height="44" rx="4" />
        <text x="542" y="34">{{ names.codex }}</text>
      </g>
      <g class="node target t1 claude">
        <rect x="452" y="68" width="180" height="44" rx="4" />
        <text x="542" y="94">{{ names.claude }}</text>
      </g>
      <g class="node target t2 antigravity">
        <rect x="452" y="128" width="180" height="44" rx="4" />
        <text x="542" y="154">{{ names.antigravity }}</text>
      </g>
      <g class="node target t3 ollama">
        <rect x="452" y="188" width="180" height="44" rx="4" />
        <text x="542" y="214">{{ names.ollama }}</text>
      </g>
    </svg>
    <figcaption>
      multi-llm dispatches the same prompt in parallel. A provider failing or
      hitting quota does not fail the others.
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { PROVIDER_DOCS, type ProviderId } from "../../theme/providers";
import { useInView } from "../../theme/useInView";

const root = ref<Element | null>(null);
const inView = useInView(root);

const names = computed(() => {
  const lower = (id: ProviderId) => PROVIDER_DOCS[id].name.toLowerCase();
  return {
    codex: lower("codex"),
    claude: lower("claude"),
    antigravity: lower("antigravity"),
    ollama: lower("ollama"),
  };
});
</script>

<style scoped>
/* figure/svg/figcaption chrome comes from the global .noir-diagram rules (custom.css) */
.node rect {
  fill: transparent;
  stroke: var(--noir-border-strong);
}
.node text {
  fill: var(--noir-text);
  font-family: var(--font-mono);
  font-size: 13px;
  text-anchor: middle;
}
.node.source rect {
  stroke: var(--accent);
}
.node.source text {
  fill: var(--accent);
}
.beam {
  stroke: var(--noir-border-strong);
  stroke-width: 1;
  stroke-dasharray: 300;
  stroke-dashoffset: 300;
}

/* Beams draw in, staggered by 0.15s * index */
.run .b0 { animation: draw 0.6s 0s ease-out forwards; }
.run .b1 { animation: draw 0.6s 0.15s ease-out forwards; }
.run .b2 { animation: draw 0.6s 0.3s ease-out forwards; }
.run .b3 { animation: draw 0.6s 0.45s ease-out forwards; }
@keyframes draw {
  to { stroke-dashoffset: 0; }
}

/* Each target rect flips its stroke to signal a returned response.
   ollama is deliberately last (2.4s) so responses read as staggered. */
.run .t0 rect { animation: lit-accent 0.4s 1.2s ease-out forwards; }
.run .t0 text { animation: lit-accent-text 0.4s 1.2s ease-out forwards; }
.run .t1 rect { animation: lit-claude 0.4s 1.6s ease-out forwards; }
.run .t1 text { animation: lit-claude-text 0.4s 1.6s ease-out forwards; }
.run .t2 rect { animation: lit-muted 0.4s 2s ease-out forwards; }
.run .t2 text { animation: lit-muted-text 0.4s 2s ease-out forwards; }
.run .t3 rect { animation: lit-muted 0.4s 2.4s ease-out forwards; }
.run .t3 text { animation: lit-muted-text 0.4s 2.4s ease-out forwards; }

@keyframes lit-accent { to { stroke: var(--accent); } }
@keyframes lit-accent-text { to { fill: var(--accent); } }
@keyframes lit-claude { to { stroke: var(--claude); } }
@keyframes lit-claude-text { to { fill: var(--claude); } }
@keyframes lit-muted { to { stroke: var(--noir-text-2); } }
@keyframes lit-muted-text { to { fill: var(--noir-text-2); } }

@media (prefers-reduced-motion: reduce) {
  .beam {
    animation: none !important;
    stroke-dashoffset: 0;
  }
  .t0 rect { stroke: var(--accent); }
  .t0 text { fill: var(--accent); }
  .t1 rect { stroke: var(--claude); }
  .t1 text { fill: var(--claude); }
  .t2 rect,
  .t3 rect { stroke: var(--noir-text-2); }
  .t2 text,
  .t3 text { fill: var(--noir-text-2); }
  .node rect,
  .node text { animation: none !important; }
}
</style>
