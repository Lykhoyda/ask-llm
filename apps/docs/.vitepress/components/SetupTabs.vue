<template>
  <div class="setup-tabs-container">
    <div class="setup-tabs">
      <div class="tab-header">
        <div class="mac-dots"><span></span><span></span><span></span></div>
        <div class="tab-buttons">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            :class="['tab-button', { active: activeTab === tab.id }]"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
      <div class="tab-content">
        <transition name="fade" mode="out-in">
          <div
            v-if="activeTab === 'claude-code'"
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
<span class="line"><span>claude mcp add {{ cfg.serverName }} -- npx -y {{ cfg.pkg }}</span></span>
<span class="line"></span>
<span class="line"><span class="comment"># User scope (all projects)</span></span>
<span class="line"><span>claude mcp add --scope user {{ cfg.serverName }} -- npx -y {{ cfg.pkg }}</span></span></code></pre>
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
            v-else-if="activeTab === 'claude-desktop'"
            class="tab-panel"
            key="claude-desktop"
          >
            <div class="panel-inner">
              <p class="config-hint">
                Add to <code>claude_desktop_config.json</code>:
              </p>
              <div class="language-json">
                <button title="Copy Code" class="copy"></button>
                <span class="lang">json</span>
                <pre class="shiki"><code><span class="line">{</span>
<span class="line">  <span class="string">"mcpServers"</span>: {</span>
<span class="line">    <span class="string">"{{ cfg.serverName }}"</span>: {</span>
<span class="line">      <span class="string">"command"</span>: <span class="string">"npx"</span>,</span>
<span class="line">      <span class="string">"args"</span>: [<span class="string">"-y"</span>, <span class="string">"{{ cfg.pkg }}"</span>]</span>
<span class="line">    }</span>
<span class="line">  }</span>
<span class="line">}</span></code></pre>
              </div>
            </div>
          </div>
          <div
            v-else-if="activeTab === 'cursor'"
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
<span class="line">    <span class="string">"{{ cfg.serverName }}"</span>: {</span>
<span class="line">      <span class="string">"command"</span>: <span class="string">"npx"</span>,</span>
<span class="line">      <span class="string">"args"</span>: [<span class="string">"-y"</span>, <span class="string">"{{ cfg.pkg }}"</span>]</span>
<span class="line">    }</span>
<span class="line">  }</span>
<span class="line">}</span></code></pre>
              </div>
            </div>
          </div>
          <div v-else-if="activeTab === 'codex'" class="tab-panel" key="codex">
            <div class="panel-inner">
              <p class="config-hint">Run in your terminal:</p>
              <div class="language-bash">
                <button title="Copy Code" class="copy"></button>
                <span class="lang">bash</span>
                <pre
                  class="shiki"
                ><code><span class="line">codex mcp add {{ cfg.serverName }} -- npx -y {{ cfg.pkg }}</span></code></pre>
              </div>
            </div>
          </div>
          <div
            v-else-if="activeTab === 'antigravity'"
            class="tab-panel"
            key="antigravity"
          >
            <div class="panel-inner">
              <p class="config-hint">Add to <code>~/.gemini/mcp.json</code>:</p>
              <div class="language-json">
                <button title="Copy Code" class="copy"></button>
                <span class="lang">json</span>
                <pre class="shiki"><code><span class="line">{</span>
<span class="line">  <span class="string">"mcpServers"</span>: {</span>
<span class="line">    <span class="string">"{{ cfg.serverName }}"</span>: {</span>
<span class="line">      <span class="string">"command"</span>: <span class="string">"npx"</span>,</span>
<span class="line">      <span class="string">"args"</span>: [<span class="string">"-y"</span>, <span class="string">"{{ cfg.pkg }}"</span>]</span>
<span class="line">    }</span>
<span class="line">  }</span>
<span class="line">}</span></code></pre>
              </div>
            </div>
          </div>
          <div
            v-else-if="activeTab === 'opencode'"
            class="tab-panel"
            key="opencode"
          >
            <div class="panel-inner">
              <p class="config-hint">Add to <code>opencode.json</code>:</p>
              <div class="language-json">
                <button title="Copy Code" class="copy"></button>
                <span class="lang">json</span>
                <pre class="shiki"><code><span class="line">{</span>
<span class="line">  <span class="string">"mcp"</span>: {</span>
<span class="line">    <span class="string">"{{ cfg.serverName }}"</span>: {</span>
<span class="line">      <span class="string">"type"</span>: <span class="string">"local"</span>,</span>
<span class="line">      <span class="string">"command"</span>: [<span class="string">"npx"</span>, <span class="string">"-y"</span>, <span class="string">"{{ cfg.pkg }}"</span>]</span>
<span class="line">    }</span>
<span class="line">  }</span>
<span class="line">}</span></code></pre>
              </div>
            </div>
          </div>
          <div v-else class="tab-panel" key="other">
            <div class="panel-inner">
              <p class="config-hint">Standard STDIO transport config:</p>
              <div class="language-json">
                <button title="Copy Code" class="copy"></button>
                <span class="lang">json</span>
                <pre class="shiki"><code><span class="line">{</span>
<span class="line">  <span class="string">"command"</span>: <span class="string">"npx"</span>,</span>
<span class="line">  <span class="string">"args"</span>: [<span class="string">"-y"</span>, <span class="string">"{{ cfg.pkg }}"</span>]</span>
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
import { ref, computed } from "vue";

interface ProviderConfig {
  pkg: string;
  serverName: string;
}

const providerConfigs: Record<string, ProviderConfig> = {
  gemini: { pkg: "ask-gemini-mcp", serverName: "gemini-cli" },
  codex: { pkg: "ask-codex-mcp", serverName: "codex-cli" },
  claude: { pkg: "ask-claude-mcp", serverName: "claude" },
  ollama: { pkg: "ask-ollama-mcp", serverName: "ollama" },
  antigravity: { pkg: "ask-antigravity-mcp", serverName: "antigravity" },
  unified: { pkg: "ask-llm-mcp", serverName: "ask-llm" },
};

const props = withDefaults(defineProps<{ provider?: string }>(), {
  provider: "gemini",
});

const cfg = computed(() => providerConfigs[props.provider] ?? providerConfigs.gemini);

const activeTab = ref(props.provider === "claude" ? "codex" : "claude-code");

const tabs = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "cursor", label: "Cursor" },
  { id: "codex", label: "Codex CLI" },
  { id: "antigravity", label: "Antigravity" },
  { id: "opencode", label: "OpenCode" },
  { id: "other", label: "Other" },
];
</script>

<style scoped>
.setup-tabs-container {
  margin: 32px 0;
  display: flex;
  justify-content: center;
}

.setup-tabs {
  width: 100%;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-bg-border);
  overflow: hidden;
  transition: box-shadow 0.2s ease;
  clip-path: polygon(
    var(--corner-size) 0%,
    100% 0%,
    100% calc(100% - var(--corner-size)),
    calc(100% - var(--corner-size)) 100%,
    0% 100%,
    0% var(--corner-size)
  );
}

.setup-tabs:hover {
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
}

.tab-header {
  display: flex;
  align-items: center;
  background: var(--color-bg-hover);
  border-bottom: 1px solid var(--color-bg-border);
  padding: 12px 16px;
  overflow-x: auto;
  scrollbar-width: none;
}

.tab-header::-webkit-scrollbar {
  display: none;
}

.mac-dots {
  display: flex;
  gap: 8px;
  margin-right: 24px;
  flex-shrink: 0;
}

.mac-dots span {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.1),
    inset 0 -1px 2px rgba(0, 0, 0, 0.3);
}

.mac-dots span:nth-child(1) {
  background-color: #ff5f56;
  border: 1px solid #e0443e;
}

.mac-dots span:nth-child(2) {
  background-color: #ffbd2e;
  border: 1px solid #dea123;
}

.mac-dots span:nth-child(3) {
  background-color: #27c93f;
  border: 1px solid #1aab29;
}

.tab-buttons {
  display: flex;
  gap: 4px;
}

.tab-button {
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
  background: transparent;
  border: none;
  white-space: nowrap;
  position: relative;
}

.tab-button:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.tab-button:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: -2px;
}

.tab-button.active {
  color: var(--color-brand);
  background: var(--color-brand-glow);
}

.tab-button.active::after {
  content: "";
  position: absolute;
  bottom: -13px;
  left: 0;
  right: 0;
  height: 2px;
  background-color: var(--color-brand);
  border-radius: 2px 2px 0 0;
}

.tab-panel {
  width: 100%;
}

.panel-inner {
  padding: 24px;
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

.config-hint {
  font-size: 14px;
  color: var(--color-text-secondary);
  margin: 0 0 16px;
}

.config-hint.plugin-hint {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--color-bg-border-subtle);
}

.config-hint code {
  background: var(--color-bg-hover);
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  border: 1px solid var(--color-bg-border-subtle);
  color: var(--color-brand);
}

.tab-panel :deep(div[class*="language-"]) {
  margin: 0;
  border-radius: var(--radius-md);
  background: var(--color-bg);
  border: 1px solid var(--color-bg-border-subtle);
}

.tab-panel :deep(div[class*="language-"]:last-child),
.tab-panel :deep(pre) {
  margin-bottom: 0 !important;
}

.tab-panel :deep(pre.shiki) {
  color: var(--color-text-secondary);
}

.comment {
  color: var(--color-text-muted);
  font-style: italic;
}

.string {
  color: var(--color-brand);
}
</style>
