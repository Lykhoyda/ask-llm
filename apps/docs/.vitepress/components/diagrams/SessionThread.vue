<template>
  <figure ref="root" class="noir-diagram">
    <svg
      viewBox="0 0 640 140"
      role="img"
      aria-label="Diagram: passing the returned sessionId threads later calls onto the same provider conversation."
      :class="{ run: inView }"
    >
      <line class="timeline" x1="40" y1="70" x2="600" y2="70" />

      <g class="call c1">
        <text class="label" x="120" y="40">call 1</text>
        <circle class="marker" cx="120" cy="70" r="8" />
      </g>
      <g class="call c2">
        <text class="label" x="320" y="40">call 2 (sessionId)</text>
        <circle class="marker" cx="320" cy="70" r="8" />
      </g>
      <g class="call c3">
        <text class="label" x="520" y="40">call 3 (sessionId)</text>
        <circle class="marker" cx="520" cy="70" r="8" />
      </g>

      <text class="annotation" x="320" y="104">cache bypassed</text>
    </svg>
    <figcaption>
      The first call returns a sessionId. Passing it back continues the same
      conversation, and cached responses are skipped for session calls.
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
.timeline {
  stroke: var(--noir-border-strong);
  stroke-width: 1;
  stroke-dasharray: 560;
  stroke-dashoffset: 560;
}
.marker {
  fill: var(--accent);
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(0);
  opacity: 0;
}
.label {
  fill: var(--noir-text);
  font-family: var(--font-mono);
  font-size: 12px;
  text-anchor: middle;
  opacity: 0;
}
.annotation {
  fill: var(--noir-text-3);
  font-family: var(--font-mono);
  font-size: 11px;
  text-anchor: middle;
  opacity: 0;
}

/* Timeline draws over 1s, markers pop at 1.0/1.4/1.8s, annotation at 2.2s */
.run .timeline { animation: draw 1s 0s ease-out forwards; }
.run .c1 .marker { animation: pop 0.4s 1s ease-out forwards; }
.run .c1 .label { animation: fade 0.4s 1s ease-out forwards; }
.run .c2 .marker { animation: pop 0.4s 1.4s ease-out forwards; }
.run .c2 .label { animation: fade 0.4s 1.4s ease-out forwards; }
.run .c3 .marker { animation: pop 0.4s 1.8s ease-out forwards; }
.run .c3 .label { animation: fade 0.4s 1.8s ease-out forwards; }
.run .annotation { animation: fade 0.4s 2.2s ease-out forwards; }

@keyframes draw {
  to { stroke-dashoffset: 0; }
}
@keyframes pop {
  from { transform: scale(0); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
@keyframes fade {
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .timeline {
    animation: none !important;
    stroke-dashoffset: 0;
  }
  .marker {
    animation: none !important;
    transform: scale(1);
    opacity: 1;
  }
  .label,
  .annotation {
    animation: none !important;
    opacity: 1;
  }
}
</style>
