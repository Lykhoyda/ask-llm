---
layout: home

hero:
  name: "Ask LLM"
  text: "Get a second opinion before you ship"
  tagline: "Let your AI assistant consult Codex, Claude, Antigravity, Ollama, or Gemini for an independent code review, a plan debate, or a fresh pair of eyes on a diff. Standard MCP — works in Claude Code, Codex CLI, Cursor, and 40+ clients."
  actions:
    - theme: brand
      text: Install Plugin
      link: /plugin/overview
    - theme: alt
      text: Quick Start (MCP)
      link: /getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/Lykhoyda/ask-llm
---

<div class="vp-doc home-content">

<InAction />

<h2 class="section-title">Claude Code Plugin</h2>

<div class="provider-grid">
  <a href="/ask-llm/plugin/overview" class="provider-card plugin-featured" data-provider="plugin">
    <span class="provider-name">Ask LLM Plugin</span>
    <span class="provider-desc">Multi-provider code review, brainstorming, and automated hooks for Claude Code. Parallel Gemini + Codex reviews with 4-phase validation pipeline and consensus highlighting.</span>
    <span class="provider-pkg">/plugin marketplace add Lykhoyda/ask-llm && /plugin install ask-llm@ask-llm-plugins</span>
  </a>
</div>

<h2 class="section-title">MCP Servers</h2>

<div class="provider-grid">
  <a href="/ask-llm/providers/unified" class="provider-card unified-featured" data-provider="unified">
    <span class="provider-name">Unified — start here</span>
    <span class="provider-desc">All providers in one server. Auto-detects the CLIs you have installed and routes each request, or fans the same prompt out to several at once.</span>
    <span class="provider-pkg">npx ask-llm-mcp</span>
  </a>
  <a href="/ask-llm/providers/codex" class="provider-card" data-provider="codex">
    <span class="provider-name">Codex</span>
    <span class="provider-desc">OpenAI's Codex CLI (GPT-5.5). Strongest code reasoning — the default workhorse reviewer.</span>
    <span class="provider-pkg">npx ask-codex-mcp</span>
  </a>
  <a href="/ask-llm/providers/claude" class="provider-card" data-provider="claude">
    <span class="provider-name">Claude</span>
    <span class="provider-desc">Anthropic Claude Code CLI (Opus → Sonnet). The reverse path for Codex and other MCP clients to request a read-only Claude second opinion.</span>
    <span class="provider-pkg">npx @anton-lykhoyda/ask-claude-mcp</span>
  </a>
  <a href="/ask-llm/providers/antigravity" class="provider-card" data-provider="antigravity">
    <span class="provider-name">Antigravity</span>
    <span class="provider-desc">Google Antigravity (agy) — a subscription-backed second opinion via your Google AI Pro/Ultra plan. The Gemini CLI successor.</span>
    <span class="provider-pkg">npx ask-antigravity-mcp</span>
  </a>
  <a href="/ask-llm/providers/ollama" class="provider-card" data-provider="ollama">
    <span class="provider-name">Ollama</span>
    <span class="provider-desc">Local models via Ollama. No API keys, fully private, zero cost — for code that can't leave your machine.</span>
    <span class="provider-pkg">npx ask-ollama-mcp</span>
  </a>
  <a href="/ask-llm/providers/gemini" class="provider-card" data-provider="gemini">
    <span class="provider-name">Gemini <span class="provider-tag">enterprise</span></span>
    <span class="provider-desc">Google's Gemini CLI. 1M+ token context for whole-codebase reads. Gated to enterprise seats from 2026-06-18.</span>
    <span class="provider-pkg">npx ask-gemini-mcp</span>
  </a>
</div>

<h2 class="section-title">Installation</h2>

<SetupTabs provider="unified" />

<div class="features-grid">
  <div class="feature-card">
    <div class="icon-wrapper">
      <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
    </div>
    <h3>Quick Setup</h3>
    <p>Get started in minutes. Pick your client, add the MCP server, and you're live. Requires <a href="https://nodejs.org/" target="_blank">Node.js</a> v20+ and the relevant CLI authenticated.</p>
  </div>
  <div class="feature-card highlight">
    <div class="icon-wrapper">
      <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
    </div>
    <h3>Verify</h3>
    <p>Ask your AI assistant: <code>Use ask-llm ping to test the connection</code>. Got <em>Pong!</em> back? You're ready. See <a href="/ask-llm/usage/how-to-ask">How to Ask</a> for usage examples.</p>
  </div>
  <div class="feature-card">
    <div class="icon-wrapper">
      <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 Z"/></svg>
    </div>
    <h3>Standard MCP</h3>
    <p>Works with 40+ MCP-compatible clients. No prompt hacks. Your primary LLM transparently delegates research, reviews, or brainstorming to other providers.</p>
  </div>
  <div class="feature-card">
    <div class="icon-wrapper">
      <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    </div>
    <h3>Multi-Turn Sessions</h3>
    <p>Continue conversations across multiple calls. Review code, then follow up for fixes. See <a href="/ask-llm/usage/multi-turn-sessions">Multi-Turn Sessions</a> for details.</p>
  </div>
</div>

<h2 class="section-title">Explore the Docs</h2>

<div class="next-steps-grid">
  <a href="/ask-llm/concepts/how-it-works" class="next-step-card">
    <div class="next-step-icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    </div>
    <span class="next-step-label">How It Works</span>
    <span class="next-step-desc">Understand the request flow</span>
  </a>
  <a href="/ask-llm/usage/how-to-ask" class="next-step-card">
    <div class="next-step-icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
    </div>
    <span class="next-step-label">How to Ask</span>
    <span class="next-step-desc">Usage patterns and examples</span>
  </a>
  <a href="/ask-llm/concepts/models" class="next-step-card">
    <div class="next-step-icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
    </div>
    <span class="next-step-label">Model Selection</span>
    <span class="next-step-desc">Pro vs Flash and when to use each</span>
  </a>
  <a href="/ask-llm/usage/multi-turn-sessions" class="next-step-card">
    <div class="next-step-icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    </div>
    <span class="next-step-label">Multi-Turn Sessions</span>
    <span class="next-step-desc">Continue conversations across calls</span>
  </a>
  <a href="/ask-llm/resources/troubleshooting" class="next-step-card">
    <div class="next-step-icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
    </div>
    <span class="next-step-label">Troubleshooting</span>
    <span class="next-step-desc">Common issues and fixes</span>
  </a>
</div>

</div>
