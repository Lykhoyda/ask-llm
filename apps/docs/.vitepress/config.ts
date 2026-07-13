import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

const SITE_URL = "https://lykhoyda.github.io/ask-llm";
const SITE_HOSTNAME = "https://lykhoyda.github.io/ask-llm/";
const SITE_TITLE = "Ask LLM";
const SITE_DESCRIPTION =
  "MCP servers for AI-to-AI collaboration — Gemini, Codex, Claude, Ollama, Antigravity";

export default withMermaid(
  defineConfig({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    base: "/ask-llm/",

    appearance: "force-dark",

    sitemap: {
      hostname: SITE_HOSTNAME,
    },

    vite: {
      build: {
        chunkSizeWarningLimit: 2600,
      },
    },

    // Global head — non-page-specific tags only.
    // Page-specific OG/Twitter/canonical tags are generated per-page
    // via transformPageData below (prevents duplicate meta tags).
    head: [
      ["meta", { name: "theme-color", content: "#0a0a0b" }],
      ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
      [
        "link",
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossorigin: "",
        },
      ],
      [
        "link",
        {
          href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap",
          rel: "stylesheet",
        },
      ],
      [
        "link",
        {
          rel: "alternate",
          type: "text/plain",
          href: `${SITE_URL}/llms.txt`,
          title: "LLM-readable documentation",
        },
      ],
      [
        "script",
        { type: "application/ld+json" },
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SITE_TITLE,
          url: `${SITE_URL}/`,
          description: SITE_DESCRIPTION,
          publisher: {
            "@type": "Organization",
            name: "Ask LLM",
            url: "https://github.com/Lykhoyda/ask-llm",
          },
        }),
      ],
    ],

    // Generate per-page OG, Twitter, and canonical tags dynamically.
    transformPageData(pageData) {
      const title = pageData.title
        ? `${pageData.title} | ${SITE_TITLE}`
        : SITE_TITLE;
      const description = pageData.description || SITE_DESCRIPTION;

      // Build the canonical URL from the relative path.
      // index.md → /ask-llm/ ; providers/gemini.md → /ask-llm/providers/gemini.html
      const pagePath = pageData.relativePath
        .replace(/index\.md$/, "")
        .replace(/\.md$/, ".html");
      const canonicalUrl = `${SITE_URL}/${pagePath}`;
      const ogImageUrl = `${SITE_URL}/og-image.png`;

      pageData.frontmatter.head ??= [];
      pageData.frontmatter.head.push(
        ["link", { rel: "canonical", href: canonicalUrl }],
        ["meta", { property: "og:title", content: title }],
        ["meta", { property: "og:description", content: description }],
        ["meta", { property: "og:type", content: "website" }],
        ["meta", { property: "og:url", content: canonicalUrl }],
        ["meta", { property: "og:image", content: ogImageUrl }],
        ["meta", { name: "twitter:card", content: "summary_large_image" }],
        ["meta", { name: "twitter:title", content: title }],
        ["meta", { name: "twitter:description", content: description }],
        ["meta", { name: "twitter:image", content: ogImageUrl }],
      );
    },

    themeConfig: {
      siteTitle: "Ask LLM",

      nav: [
        { text: "Home", link: "/" },
        { text: "Guide", link: "/getting-started" },
        {
          text: "Providers",
          items: [
            { text: "Codex", link: "/providers/codex" },
            { text: "Claude", link: "/providers/claude" },
            { text: "Antigravity", link: "/providers/antigravity" },
            { text: "Ollama", link: "/providers/ollama" },
            { text: "Gemini", link: "/providers/gemini" },
            { text: "Unified", link: "/providers/unified" },
          ],
        },
        { text: "Claude Plugin", link: "/plugin/overview" },
      ],

      sidebar: [
        {
          text: "Getting Started",
          collapsed: false,
          items: [
            { text: "Overview", link: "/" },
            { text: "Quick Start", link: "/getting-started" },
            { text: "Installation", link: "/installation" },
            { text: "First Steps", link: "/first-steps" },
          ],
        },
        {
          text: "Providers",
          collapsed: false,
          items: [
            { text: "Codex", link: "/providers/codex" },
            { text: "Claude", link: "/providers/claude" },
            { text: "Antigravity", link: "/providers/antigravity" },
            { text: "Ollama", link: "/providers/ollama" },
            { text: "Gemini", link: "/providers/gemini" },
            { text: "Unified (ask-llm)", link: "/providers/unified" },
          ],
        },
        {
          text: "Claude Plugin",
          collapsed: false,
          items: [
            { text: "Overview", link: "/plugin/overview" },
            { text: "Skills", link: "/plugin/skills" },
            { text: "Hooks", link: "/plugin/hooks" },
            { text: "Agents", link: "/plugin/agents" },
          ],
        },
        {
          text: "Core Concepts",
          collapsed: false,
          items: [
            { text: "How It Works", link: "/concepts/how-it-works" },
            { text: "Model Selection", link: "/concepts/models" },
            { text: "Sandbox Mode", link: "/concepts/sandbox" },
          ],
        },
        {
          text: "User Guide",
          collapsed: false,
          items: [
            { text: "How to Ask", link: "/usage/how-to-ask" },
            {
              text: "Multi-Turn Sessions",
              link: "/usage/multi-turn-sessions",
            },
            {
              text: "Strategies & Examples",
              link: "/usage/strategies-and-examples",
            },
          ],
        },
        {
          text: "Resources",
          collapsed: true,
          items: [
            { text: "Troubleshooting", link: "/resources/troubleshooting" },
            { text: "FAQ", link: "/resources/faq" },
          ],
        },
      ],

      socialLinks: [
        { icon: "github", link: "https://github.com/Lykhoyda/ask-llm" },
      ],

      footer: {
        message: "Released under the MIT License.",
        copyright: "Making AI collaboration simple, one tool at a time.",
      },

      search: {
        provider: "local",
      },
    },
  }),
);
