<template>
  <figure ref="root" class="noir-diagram pair-loop">
    <svg
      viewBox="0 0 640 150"
      role="img"
      aria-label="Diagram: Claude and Codex exchange review requests in both directions."
      :class="{ run: inView }"
    >
      <g class="node claude">
        <rect x="8" y="45" width="180" height="60" rx="4" />
        <text x="98" y="80">▮ claude</text>
      </g>
      <g class="node codex">
        <rect x="452" y="45" width="180" height="60" rx="4" />
        <text x="542" y="80">▮ codex</text>
      </g>
      <path class="arc top" d="M 188 60 C 290 20, 350 20, 452 60" fill="none" />
      <path class="arc bottom" d="M 452 90 C 350 130, 290 130, 188 90" fill="none" />
      <circle class="pulse to-codex" r="4" />
      <circle class="pulse to-claude" r="4" />
    </svg>
    <figcaption>
      Claude asks Codex for a second opinion; Codex asks Claude back through
      the reverse path. Each reads, your agent edits.
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
.node text {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  text-anchor: middle;
}
.node.claude rect { fill: var(--claude-tint); stroke: var(--claude); }
.node.claude text { fill: var(--claude); }
.node.codex rect { fill: var(--accent-tint); stroke: var(--accent); }
.node.codex text { fill: var(--accent); }
.arc { stroke: var(--noir-border-strong); stroke-width: 1; }
.pulse { opacity: 0; }
.to-codex { fill: var(--claude); }
.to-claude { fill: var(--accent); }
.run .to-codex {
  offset-path: path("M 188 60 C 290 20, 350 20, 452 60");
  animation: travel 1.4s 0.2s ease-in-out infinite;
}
.run .to-claude {
  offset-path: path("M 452 90 C 350 130, 290 130, 188 90");
  animation: travel 1.4s 0.9s ease-in-out infinite;
}
@keyframes travel {
  0% { opacity: 0; offset-distance: 0%; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { opacity: 0; offset-distance: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .pulse { animation: none !important; opacity: 0; }
}
</style>
