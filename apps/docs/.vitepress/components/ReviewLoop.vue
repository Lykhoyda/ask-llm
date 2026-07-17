<template>
  <section ref="root" class="review-loop">
    <h2 class="rl-heading">The review loop</h2>
    <p class="rl-sub">
      Claude and Codex review each other's work. The other model reads, your
      agent edits.
    </p>
    <div class="rl-grid">
      <a
        :href="withBase(claude.docPath)"
        class="rl-card reveal claude"
        :class="{ 'in-view': inView }"
      >
        <span class="rl-title">▮ {{ claude.name }}</span>
        <span class="rl-tagline">{{ claude.tagline }}</span>
        <span class="rl-cmd">$ npx {{ claude.pkg }}</span>
        <span class="rl-model">
          default {{ claude.defaultModel }} → fallback {{ claude.fallbackModel }}
        </span>
      </a>
      <div class="rl-arrows" aria-hidden="true">
        <span class="arrow to-codex">⇀</span>
        <span class="arrow to-claude">↽</span>
      </div>
      <a
        :href="withBase(codex.docPath)"
        class="rl-card reveal codex second"
        :class="{ 'in-view': inView }"
      >
        <span class="rl-title">▮ {{ codex.name }}</span>
        <span class="rl-tagline">{{ codex.tagline }}</span>
        <span class="rl-cmd">$ npx {{ codex.pkg }}</span>
        <span class="rl-model">
          default {{ codex.defaultModel }} → fallback {{ codex.fallbackModel }}
        </span>
      </a>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { withBase } from "vitepress";
import { useInView } from "../theme/useInView";
import { PROVIDER_DOCS, HERO_IDS } from "../theme/providers";

const root = ref<Element | null>(null);
const inView = useInView(root);
const [claude, codex] = HERO_IDS.map((id) => PROVIDER_DOCS[id]);
</script>

<style scoped>
.review-loop {
  margin: var(--space-16) 0 0;
}
.rl-heading {
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 700;
  border: none;
  margin: 0 0 var(--space-2);
  padding: 0;
}
.rl-sub {
  font-family: var(--font-sans);
  color: var(--noir-text-2);
  font-size: 15px;
  max-width: 60ch;
  margin: 0 0 var(--space-8);
}
.rl-grid {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--space-4);
}
.rl-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-6);
  border: 1px solid var(--noir-border-strong);
  border-radius: var(--radius);
  text-decoration: none;
  height: 100%;
  transition: opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.15s ease;
}
.rl-card.second { transition-delay: 60ms; }
.rl-card.claude { background: var(--claude-tint); }
.rl-card.codex { background: var(--accent-tint); }
.rl-card.claude:hover { border-color: var(--claude); }
.rl-card.codex:hover { border-color: var(--accent); }
.rl-card:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
.rl-title {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
}
.rl-card.claude .rl-title { color: var(--claude); }
.rl-card.codex .rl-title { color: var(--accent); }
.rl-tagline {
  font-family: var(--font-sans);
  color: var(--noir-text-2);
  font-size: 14px;
  line-height: 1.6;
}
.rl-cmd {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--noir-text);
  background: var(--noir-bg);
  border: 1px solid var(--noir-border);
  border-radius: var(--radius);
  padding: var(--space-2) var(--space-3);
  margin-top: var(--space-2);
  overflow-x: auto;
}
.rl-model {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--noir-text-3);
}
.rl-arrows {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: 24px;
  line-height: 1;
}
.arrow.to-codex { color: var(--accent); animation: pulse-a 2.8s ease-in-out infinite; }
.arrow.to-claude { color: var(--claude); animation: pulse-b 2.8s ease-in-out infinite; }
@keyframes pulse-a {
  0%, 100% { opacity: 0.3; }
  25% { opacity: 1; }
}
@keyframes pulse-b {
  0%, 100% { opacity: 0.3; }
  75% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .arrow { animation: none !important; opacity: 0.6; }
}
@media (max-width: 640px) {
  .rl-grid { grid-template-columns: 1fr; }
  .rl-arrows { flex-direction: row; padding: var(--space-2) 0; }
}
</style>
