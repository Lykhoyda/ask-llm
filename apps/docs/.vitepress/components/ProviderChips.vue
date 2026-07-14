<template>
  <section class="provider-chips">
    <span class="pc-label">Also speaks:</span>
    <a
      v-for="doc in supporting"
      :key="doc.id"
      :href="withBase(doc.docPath)"
      class="pc-chip"
    >
      {{ doc.name }}<span class="pc-note">{{ annotation(doc) }}</span>
    </a>
    <a :href="withBase(unified.docPath)" class="pc-chip pc-unified">
      unified: all of them →
    </a>
  </section>
</template>

<script setup lang="ts">
import { withBase } from "vitepress";
import {
  PROVIDER_DOCS,
  SUPPORTING_IDS,
  type ProviderDoc,
} from "../theme/providers";

const supporting = SUPPORTING_IDS.map((id) => PROVIDER_DOCS[id]);
const unified = PROVIDER_DOCS.unified;

// Short display annotation per supporting provider. Mapped explicitly by id:
// Antigravity ships via the `agy` CLI; Ollama runs local; Gemini is
// enterprise-gated. Kept independent of `status` so provider-metadata
// changes cannot silently alter the chip labels.
const ANNOTATIONS: Record<string, string> = {
  antigravity: "agy",
  ollama: "local",
  gemini: "enterprise",
};

function annotation(doc: ProviderDoc): string {
  return ANNOTATIONS[doc.id] ?? "";
}
</script>

<style scoped>
.provider-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin: var(--space-8) 0 0;
}
.pc-label {
  font-family: var(--font-sans);
  color: var(--noir-text-2);
  font-size: 13px;
}
.pc-chip {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--noir-text-2);
  border: 1px solid var(--noir-border);
  border-radius: var(--radius);
  padding: var(--space-1) var(--space-3);
  text-decoration: none;
  transition: border-color 0.15s ease;
}
.pc-chip:hover { border-color: var(--accent); }
.pc-chip:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
.pc-note { color: var(--noir-text-3); }
.pc-unified {
  border-color: var(--noir-border-strong);
  color: var(--noir-text);
}
</style>
