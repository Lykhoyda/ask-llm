<template>
  <div class="setup-tabs-container">
    <div class="setup-tabs">
      <div class="tab-panel panel-inner">
        <p class="config-hint">Run in your terminal:</p>
        <div class="language-bash">
          <button type="button" title="Copy Code" class="copy" @click="copyCommand"></button>
          <span class="lang">bash</span>
          <pre class="shiki"><code><span class="line">{{ command }}</span></code></pre>
        </div>
        <p class="config-hint after-install">
          Choose your coding assistant, inspect the preview, and confirm the changes.
          Then start a new session and ask for a review.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Old provider pages still pass this prop; every provider now uses the same setup.
defineProps<{ provider?: string }>();
const command = "npm i -g @ask-llm/mcp && ask-llm setup";
async function copyCommand() {
  await navigator.clipboard.writeText(command);
}
</script>

<style scoped>
.setup-tabs-container {
  margin: var(--space-8) 0;
  display: flex;
  justify-content: center;
}
.setup-tabs {
  width: 100%;
  background: var(--noir-raised);
  border: 1px solid var(--noir-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.panel-inner { padding: var(--space-6); }
.config-hint {
  font-size: 14px;
  color: var(--noir-text-2);
  margin: 0 0 var(--space-4);
}
.after-install { margin: var(--space-4) 0 0; }
.tab-panel :deep(div[class*="language-"]) {
  margin: 0;
  border-radius: var(--radius);
  background: var(--noir-bg);
  border: 1px solid var(--noir-border);
}
.tab-panel :deep(pre) { margin-bottom: 0 !important; }
.tab-panel :deep(pre.shiki) { color: var(--noir-text-2); }
</style>
