import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

const SITE_URL = "https://lykhoyda.github.io/ask-llm";
const SITE_HOSTNAME = "https://lykhoyda.github.io/ask-llm/";
const SITE_TITLE = "Ask LLM";
const SITE_DESCRIPTION =
  "Get a second opinion on your code or plan, inside your coding assistant, using the model subscriptions you already have.";

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

    // Global head: non-page-specific tags only.
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
          href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&display=swap",
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
      const title = pageData.title ? `${pageData.title} | ${SITE_TITLE}` : SITE_TITLE;
      const description = pageData.description || SITE_DESCRIPTION;

      // Build the canonical URL from the relative path.
      // index.md → /ask-llm/ ; providers/gemini.md → /ask-llm/providers/gemini.html
      const pagePath = pageData.relativePath.replace(/index\.md$/, "").replace(/\.md$/, ".html");
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
        {
          text: "Home",
          link: "/",
        },
        {
          text: "Start",
          link: "/start/install",
        },
        {
          text: "Workflows",
          link: "/workflows/review-changes",
        },
        {
          text: "Compatibility",
          link: "/compatibility/hosts",
        },
      ],

      sidebar: [
        {
          text: "Start",
          collapsed: false,
          items: [
            {
              text: "Install",
              link: "/start/install",
            },
            {
              text: "First review",
              link: "/start/first-review",
            },
            {
              text: "Upgrade and remove",
              link: "/start/upgrade-remove",
            },
          ],
        },
        {
          text: "Workflows",
          collapsed: false,
          items: [
            {
              text: "Review changes",
              link: "/workflows/review-changes",
            },
            {
              text: "Challenge a plan",
              link: "/workflows/challenge-plan",
            },
            {
              text: "Compare answers",
              link: "/workflows/compare-answers",
            },
            {
              text: "Brainstorm",
              link: "/workflows/brainstorm",
            },
          ],
        },
        {
          text: "Compatibility",
          collapsed: false,
          items: [
            {
              text: "Hosts",
              link: "/compatibility/hosts",
            },
            {
              text: "Providers",
              items: [
                {
                  text: "Codex",
                  link: "/providers/codex",
                },
                {
                  text: "Claude",
                  link: "/providers/claude",
                },
                {
                  text: "Grok",
                  link: "/providers/grok",
                },
                {
                  text: "Antigravity",
                  link: "/providers/antigravity",
                },
                {
                  text: "Ollama",
                  link: "/providers/ollama",
                },
                {
                  text: "Gemini",
                  link: "/providers/gemini",
                },
              ],
            },
          ],
        },
        {
          text: "Operation",
          collapsed: false,
          items: [
            {
              text: "Diagnostics / doctor",
              link: "/operation/diagnostics",
            },
            {
              text: "Authentication",
              link: "/operation/authentication",
            },
            {
              text: "Data flow",
              link: "/operation/data-flow",
            },
            {
              text: "Costs and fallbacks",
              link: "/operation/costs",
            },
          ],
        },
        {
          text: "Advanced",
          collapsed: false,
          items: [
            {
              text: "Pair review",
              items: [
                {
                  text: "Codex pair",
                  link: "/advanced/codex-pair",
                },
                {
                  text: "Grok pair",
                  link: "/advanced/grok-pair",
                },
              ],
            },
            {
              text: "Manual MCP configuration",
              link: "/advanced/manual-configuration",
            },
            {
              text: "Enterprise environments / Gemini",
              link: "/advanced/enterprise-gemini",
            },
          ],
        },
        {
          text: "Reference",
          collapsed: false,
          items: [
            {
              text: "Tools and schemas",
              link: "/reference/tools",
            },
            {
              text: "CLI",
              link: "/reference/cli",
            },
            {
              text: "Environment variables",
              link: "/reference/environment-variables",
            },
            {
              text: "Workflow catalogue",
              link: "/reference/skills",
            },
            {
              text: "Migration from @ask-llm/*",
              link: "/reference/migration",
            },
          ],
        },
        {
          text: "Resources",
          collapsed: false,
          items: [
            {
              text: "Troubleshooting",
              link: "/resources/troubleshooting",
            },
            {
              text: "FAQ",
              link: "/resources/faq",
            },
          ],
        },
      ],

      socialLinks: [{ icon: "github", link: "https://github.com/Lykhoyda/ask-llm" }],

      footer: {
        message: "Released under the MIT License.",
        copyright: "Second opinions for coding agents.",
      },

      search: {
        provider: "local",
      },
    },
  }),
);
