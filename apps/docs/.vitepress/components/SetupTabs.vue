<template>
  <div class="setup-tabs-container">
    <div class="setup-tabs">
      <div class="tab-header">
        <div
          class="tab-buttons"
          role="tablist"
          aria-label="MCP client setup"
          @keydown="onKeydown"
        >
          <button
            v-for="(tab, index) in tabs"
            :id="`setup-tab-${tab}`"
            :key="tab"
            :ref="(el) => setTabRef(el, index)"
            role="tab"
            type="button"
            :aria-selected="activeTab === tab"
            :aria-controls="`setup-panel-${tab}`"
            :tabindex="activeTab === tab ? 0 : -1"
            :class="['tab-button', { active: activeTab === tab }]"
            @click="activeTab = tab"
          >
            {{ tabLabels[tab] }}
          </button>
          <span class="tab-underline" :style="underlineStyle" aria-hidden="true"></span>
        </div>
      </div>
      <div class="tab-content">
        <transition name="fade" mode="out-in">
          <div
            v-if="activeTab === 'claude-code'"
            id="setup-panel-claude-code"
            role="tabpanel"
            aria-labelledby="setup-tab-claude-code"
            class="tab-panel"
            key="claude-code"
          >
            <div class="panel-inner">
              <p class="config-hint">Run in your terminal:</p>
              <div class="language-bash">
                <button title="Copy Code" class="copy"></button>
                <span class="lang">bash</span>
                <pre
                  class="shiki"
                ><code><span class="line"><span class="comment"># Project scope (current project only)</span></span>
<span class="line"><span>claude mcp add {{ doc.serverName }} -- npx -y {{ doc.pkg }}</span></span>
<span class="line"></span>
<span class="line"><span class="comment"># User scope (all projects)</span></span>
<span class="line"><span>claude mcp add --scope user {{ doc.serverName }} -- npx -y {{ doc.pkg }}</span></span></code></pre>
              </div>

              <p class="config-hint plugin-hint">
                Or install as a plugin (adds slash commands like
                <code>/multi-review</code>, <code>/brainstorm</code>,
                <code>/compare</code>, plus reviewer subagents and the opt-in
                continuous <code>codex-pair</code> review hook):
              </p>
              <div class="language-bash">
                <button title="Copy Code" class="copy"></button>
                <span class="lang">bash</span>
                <pre
                  class="shiki"
                ><code><span class="line"><span>/plugin marketplace add Lykhoyda/ask-llm</span></span>
<span class="line"><span>/plugin install ask-llm@ask-llm-plugins</span></span></code></pre>
              </div>
            </div>
          </div>
          <div
            v-else-if="activeTab === 'codex'"
            id="setup-panel-codex"
            role="tabpanel"
            aria-labelledby="setup-tab-codex"
            class="tab-panel"
            key="codex"
          >
            <div class="panel-inner">
              <p class="config-hint">Run in your terminal:</p>
              <div class="language-bash">
                <button title="Copy Code" class="copy"></button>
                <span class="lang">bash</span>
                <pre
                  class="shiki"
                ><code><span class="line">codex mcp add {{ doc.serverName }} -- npx -y {{ doc.pkg }}</span></code></pre>
              </div>
            </div>
          </div>
          <div
            v-else-if="activeTab === 'cursor'"
            id="setup-panel-cursor"
            role="tabpanel"
            aria-labelledby="setup-tab-cursor"
            class="tab-panel"
            key="cursor"
          >
            <div class="panel-inner">
              <p class="config-hint">Add to <code>.cursor/mcp.json</code>:</p>
              <div class="language-json">
                <button title="Copy Code" class="copy"></button>
                <span class="lang">json</span>
                <pre class="shiki"><code><span class="line">{</span>
<span class="line">  <span class="string">"mcpServers"</span>: {</span>
<span class="line">    <span class="string">"{{ doc.serverName }}"</span>: {</span>
<span class="line">      <span class="string">"command"</span>: <span class="string">"npx"</span>,</span>
<span class="line">      <span class="string">"args"</span>: [<span class="string">"-y"</span>, <span class="string">"{{ doc.pkg }}"</span>]</span>
<span class="line">    }</span>
<span class="line">  }</span>
<span class="line">}</span></code></pre>
              </div>
            </div>
          </div>
          <div
            v-else
            id="setup-panel-json"
            role="tabpanel"
            aria-labelledby="setup-tab-json"
            class="tab-panel"
            key="json"
          >
            <div class="panel-inner">
              <p class="config-hint">
                Generic <code>mcpServers</code> config for Claude Desktop, Warp,
                and other JSON-config clients:
              </p>
              <div class="language-json">
                <button title="Copy Code" class="copy"></button>
                <span class="lang">json</span>
                <pre class="shiki"><code><span class="line">{</span>
<span class="line">  <span class="string">"mcpServers"</span>: {</span>
<span class="line">    <span class="string">"{{ doc.serverName }}"</span>: {</span>
<span class="line">      <span class="string">"command"</span>: <span class="string">"npx"</span>,</span>
<span class="line">      <span class="string">"args"</span>: [<span class="string">"-y"</span>, <span class="string">"{{ doc.pkg }}"</span>]</span>
<span class="line">    }</span>
<span class="line">  }</span>
<span class="line">}</span></code></pre>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { PROVIDER_DOCS, type ProviderId } from "../theme/providers";

const tabs = ["claude-code", "codex", "cursor", "json"] as const;
type TabId = (typeof tabs)[number];

const tabLabels: Record<TabId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  cursor: "Cursor",
  json: "JSON config",
};

const props = withDefaults(defineProps<{ provider?: ProviderId }>(), {
  provider: "unified",
});

const doc = computed(() => PROVIDER_DOCS[props.provider]);

const activeTab = ref<TabId>("claude-code");
const tabRefs = ref<(HTMLButtonElement | null)[]>([]);
const underlineStyle = ref<Record<string, string>>({
  transform: "translateX(0px)",
  width: "0px",
});

function setTabRef(el: unknown, index: number) {
  tabRefs.value[index] = el as HTMLButtonElement | null;
}

function updateUnderline() {
  const el = tabRefs.value[tabs.indexOf(activeTab.value)];
  if (!el) return;
  underlineStyle.value = {
    transform: `translateX(${el.offsetLeft}px)`,
    width: `${el.offsetWidth}px`,
  };
}

function onKeydown(event: KeyboardEvent) {
  const order = tabs.indexOf(activeTab.value);
  if (event.key === "ArrowRight") {
    event.preventDefault();
    activeTab.value = tabs[(order + 1) % tabs.length];
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    activeTab.value = tabs[(order + tabs.length - 1) % tabs.length];
  }
}

watch(activeTab, async () => {
  await nextTick();
  updateUnderline();
  tabRefs.value[tabs.indexOf(activeTab.value)]?.focus();
});

onMounted(async () => {
  await nextTick();
  updateUnderline();
});
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

.tab-header {
  display: flex;
  align-items: center;
  background: var(--noir-raised);
  border-bottom: 1px solid var(--noir-border);
  padding: var(--space-3) var(--space-4) 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.tab-header::-webkit-scrollbar {
  display: none;
}

.tab-buttons {
  display: flex;
  gap: var(--space-1);
  position: relative;
}

.tab-button {
  padding: var(--space-2) var(--space-3);
  color: var(--noir-text-2);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease;
  background: transparent;
  border: none;
  white-space: nowrap;
  position: relative;
}

.tab-button:hover {
  color: var(--noir-text);
}

.tab-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.tab-button.active {
  color: var(--accent);
}

.tab-underline {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  background-color: var(--accent);
  transition: transform 0.2s ease, width 0.2s ease;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .tab-underline {
    transition: none;
  }
}

.tab-panel {
  width: 100%;
}

.panel-inner {
  padding: var(--space-6);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .fade-enter-active,
  .fade-leave-active {
    transition: none;
  }
  .fade-enter-from,
  .fade-leave-to {
    transform: none;
  }
}

.config-hint {
  font-size: 14px;
  color: var(--noir-text-2);
  margin: 0 0 var(--space-4);
}

.config-hint.plugin-hint {
  margin-top: var(--space-6);
  padding-top: var(--space-6);
  border-top: 1px solid var(--noir-border);
}

.config-hint code {
  background: var(--noir-bg);
  padding: 3px 8px;
  border-radius: var(--radius);
  font-size: 13px;
  border: 1px solid var(--noir-border);
  color: var(--accent);
}

.tab-panel :deep(div[class*="language-"]) {
  margin: 0;
  border-radius: var(--radius);
  background: var(--noir-bg);
  border: 1px solid var(--noir-border);
}

.tab-panel :deep(div[class*="language-"]:last-child),
.tab-panel :deep(pre) {
  margin-bottom: 0 !important;
}

.tab-panel :deep(pre.shiki) {
  color: var(--noir-text-2);
}

.comment {
  color: var(--noir-text-3);
  font-style: italic;
}

.string {
  color: var(--accent);
}
</style>
