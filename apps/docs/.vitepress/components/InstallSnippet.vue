<template>
  <div class="install-snippet">
    <p class="label">1. Provider CLI</p>
    <pre><code>{{ doc.cliInstall }}</code></pre>
    <p class="label">2. Register the MCP server (Claude Code shown; see Quick Start for other clients)</p>
    <pre><code>claude mcp add --scope user {{ doc.serverName }} -- npx -y {{ doc.pkg }}</code></pre>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { PROVIDER_DOCS, type ProviderId } from "../theme/providers";

const props = defineProps<{ provider: ProviderId }>();
const doc = computed(() => PROVIDER_DOCS[props.provider]);
</script>

<style scoped>
.install-snippet {
  border: 1px solid var(--noir-border);
  border-radius: var(--radius);
  padding: var(--space-4);
  background: var(--noir-raised);
  margin: var(--space-4) 0;
}
.label {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--noir-text-3);
  margin: var(--space-2) 0;
}
pre {
  margin: 0 0 var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--noir-border);
  border-radius: var(--radius);
  background: var(--noir-bg);
  overflow-x: auto;
}
code {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--noir-text);
}
</style>
