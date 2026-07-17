<template>
  <figure ref="root" class="noir-diagram">
    <svg
      viewBox="0 0 640 120"
      role="img"
      aria-label="Diagram: a request travels from your agent to the MCP server to the provider CLI, and the response returns along the same path."
      :class="{ run: inView }"
    >
      <g class="node n1">
        <rect x="8" y="38" width="150" height="44" rx="4" />
        <text x="83" y="64">your agent</text>
      </g>
      <g class="node n2">
        <rect x="245" y="38" width="150" height="44" rx="4" />
        <text x="320" y="64">mcp server</text>
      </g>
      <g class="node n3 hot">
        <rect x="482" y="38" width="150" height="44" rx="4" />
        <text x="557" y="64">provider cli</text>
      </g>
      <line class="wire" x1="158" y1="52" x2="245" y2="52" />
      <line class="wire" x1="395" y1="52" x2="482" y2="52" />
      <line class="wire ret" x1="482" y1="68" x2="395" y2="68" />
      <line class="wire ret" x1="245" y1="68" x2="158" y2="68" />
      <circle class="pulse out1" cy="52" r="4" />
      <circle class="pulse out2" cy="52" r="4" />
      <circle class="pulse ret1" cy="68" r="4" />
      <circle class="pulse ret2" cy="68" r="4" />
    </svg>
    <figcaption>
      Your agent calls an MCP tool; the server spawns the provider CLI and
      streams the answer back as structured content.
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useInView } from "../../theme/useInView";

const root = ref<Element | null>(null);
const inView = useInView(root);
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
.node.hot rect { stroke: var(--accent); }
.node.hot text { fill: var(--accent); }
.wire { stroke: var(--noir-border-strong); stroke-width: 1; }
.pulse { fill: var(--accent); opacity: 0; }

/* Timeline: out1 0-0.9s, out2 0.9-1.8s, ret1 2-2.9s, ret2 2.9-3.8s */
.run .out1 { animation: flow-a 0.9s 0.1s ease-in-out forwards; }
.run .out2 { animation: flow-b 0.9s 1s ease-in-out forwards; }
.run .ret1 { animation: flow-c 0.9s 2.1s ease-in-out forwards; }
.run .ret2 { animation: flow-d 0.9s 3s ease-in-out forwards; }
@keyframes flow-a {
  from { opacity: 1; cx: 158px; }
  to { opacity: 0; cx: 245px; }
}
@keyframes flow-b {
  from { opacity: 1; cx: 395px; }
  to { opacity: 0; cx: 482px; }
}
@keyframes flow-c {
  from { opacity: 1; cx: 482px; }
  to { opacity: 0; cx: 395px; }
}
@keyframes flow-d {
  from { opacity: 1; cx: 245px; }
  to { opacity: 0; cx: 158px; }
}
@media (prefers-reduced-motion: reduce) {
  .pulse { animation: none !important; opacity: 0; }
}
</style>
