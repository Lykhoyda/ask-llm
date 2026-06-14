<template>
  <div class="in-action">
    <div class="ia-window">
      <div class="ia-header">
        <div class="mac-dots"><span></span><span></span><span></span></div>
        <span class="ia-title">second opinion</span>
      </div>
      <div class="ia-body">
        <p class="ia-line">
          <span class="ia-role ia-you">you</span>
          <span class="ia-text">ask codex to review <code>@src/auth.ts</code> for security issues</span>
        </p>
        <p class="ia-line">
          <span class="ia-role ia-codex">codex</span>
          <span class="ia-text"><span class="ia-warn">⚠</span> <code>verifyToken()</code> compares tokens with <code>===</code> — not timing-safe (line 42)</span>
        </p>
        <p class="ia-line">
          <span class="ia-role ia-codex">codex</span>
          <span class="ia-text"><span class="ia-warn">⚠</span> the session cookie is missing a <code>SameSite</code> attribute</span>
        </p>
        <p class="ia-line">
          <span class="ia-role ia-claude">claude</span>
          <span class="ia-text">Good catches — applying both fixes to <code>src/auth.ts</code>.</span>
        </p>
      </div>
    </div>
    <p class="ia-caption">One prompt. A second model reviews independently; your assistant applies the fix.</p>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.in-action {
  max-width: 720px;
  margin: 8px auto 56px;
  position: relative;
  z-index: 2;
}

.ia-window {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-bg-border);
  overflow: hidden;
  clip-path: polygon(
    var(--corner-size) 0%, 100% 0%, 100% calc(100% - var(--corner-size)),
    calc(100% - var(--corner-size)) 100%, 0% 100%, 0% var(--corner-size)
  );
}

.ia-header {
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--color-bg-hover);
  border-bottom: 1px solid var(--color-bg-border);
  padding: 12px 16px;
}

.mac-dots {
  display: flex;
  gap: 8px;
}
.mac-dots span {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.1),
    inset 0 -1px 2px rgba(0, 0, 0, 0.3);
}
.mac-dots span:nth-child(1) {
  background: #ff5f56;
  border: 1px solid #e0443e;
}
.mac-dots span:nth-child(2) {
  background: #ffbd2e;
  border: 1px solid #dea123;
}
.mac-dots span:nth-child(3) {
  background: #27c93f;
  border: 1px solid #1aab29;
}

.ia-title {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-muted);
}

.ia-body {
  padding: 20px 24px;
}

.ia-line {
  display: flex;
  gap: 14px;
  align-items: baseline;
  margin: 0 0 12px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
}
.ia-line:last-child {
  margin-bottom: 0;
}

.ia-role {
  flex-shrink: 0;
  width: 52px;
  text-align: right;
  font-weight: 600;
  font-size: 12px;
}
.ia-you {
  color: var(--color-brand);
}
.ia-codex {
  color: var(--color-codex);
}
.ia-claude {
  color: var(--color-plugin);
}

.ia-text {
  color: var(--color-text-secondary);
}
.ia-text code {
  font-family: var(--font-mono);
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  font-size: 0.92em;
}
.ia-warn {
  color: #fbbf24;
}

.ia-caption {
  text-align: center;
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 16px 0 0;
}
</style>
