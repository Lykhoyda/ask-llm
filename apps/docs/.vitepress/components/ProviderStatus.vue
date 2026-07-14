<template>
  <p class="provider-status">
    <span class="pkg">{{ doc.pkg }}</span>
    <span v-if="doc.status" class="badge">{{ doc.status }}</span>
    <span class="models">
      default <code>{{ doc.defaultModel }}</code><template v-if="doc.fallbackModel">
        → fallback <code>{{ doc.fallbackModel }}</code></template>
    </span>
  </p>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { PROVIDER_DOCS, type ProviderId } from "../theme/providers";

const props = defineProps<{ provider: ProviderId }>();
const doc = computed(() => PROVIDER_DOCS[props.provider]);
</script>

<style scoped>
.provider-status {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--noir-text-3);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--noir-border);
  border-bottom: 1px solid var(--noir-border);
  margin: var(--space-4) 0 var(--space-6);
}
.pkg { color: var(--noir-text); }
.badge {
  border: 1px solid var(--noir-border-strong);
  border-radius: var(--radius);
  padding: 1px 8px;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.08em;
}
.models code {
  font-size: 12px;
  background: transparent;
  padding: 0;
  color: var(--noir-text-2);
}
</style>
