<template>
  <figure ref="root" class="noir-diagram">
    <svg
      viewBox="0 0 640 120"
      role="img"
      :aria-label="`Diagram: ${doc.defaultModel} falls back to ${doc.fallbackModel} when quota is exhausted.`"
      :class="{ run: inView }"
    >
      <g class="node default">
        <rect x="8" y="38" width="200" height="44" rx="4" />
        <text x="108" y="64">{{ doc.defaultModel }}</text>
      </g>

      <text class="error-flash" x="320" y="46">quota / rate limit</text>

      <line class="wire" x1="208" y1="60" x2="432" y2="60" />

      <g class="node fallback">
        <rect x="432" y="38" width="200" height="44" rx="4" />
        <text x="532" y="64">{{ doc.fallbackModel }}</text>
      </g>
    </svg>
    <figcaption>
      When the default model hits quota, the executor retries once on the
      fallback and reports the actual model used in the response.
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { PROVIDER_DOCS } from "../../theme/providers";
import { useInView } from "../../theme/useInView";

// Only providers with a fallbackModel are valid here (excludes ollama/unified,
// whose fallbackModel is undefined and would render "undefined" in the label).
type FallbackProvider = "codex" | "claude" | "antigravity" | "gemini";
const props = defineProps<{ provider: FallbackProvider }>();
const doc = computed(() => PROVIDER_DOCS[props.provider]);
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
.node.default rect {
  stroke: var(--noir-text-2);
}
.node.default text {
  fill: var(--noir-text-2);
}
.error-flash {
  fill: var(--color-error);
  font-family: var(--font-mono);
  font-size: 12px;
  text-anchor: middle;
  opacity: 0;
}
.wire {
  stroke: var(--noir-border-strong);
  stroke-width: 1;
  stroke-dasharray: 224;
  stroke-dashoffset: 224;
}

/* quota flashes in at 0.8s, wire draws at 1.2s, fallback lights up at 1.6s */
.run .error-flash { animation: flash 0.5s 0.8s ease-out forwards; }
.run .wire { animation: draw 0.4s 1.2s ease-out forwards; }
.run .fallback rect { animation: lit 0.4s 1.6s ease-out forwards; }
.run .fallback text { animation: lit-text 0.4s 1.6s ease-out forwards; }

@keyframes flash {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes draw {
  to { stroke-dashoffset: 0; }
}
@keyframes lit { to { stroke: var(--accent); } }
@keyframes lit-text { to { fill: var(--accent); } }

@media (prefers-reduced-motion: reduce) {
  .error-flash {
    animation: none !important;
    opacity: 1;
  }
  .wire {
    animation: none !important;
    stroke-dashoffset: 0;
  }
  .fallback rect {
    animation: none !important;
    stroke: var(--accent);
  }
  .fallback text {
    animation: none !important;
    fill: var(--accent);
  }
}
</style>
