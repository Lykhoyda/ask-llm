import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "scripts",
          include: ["scripts/**/*.test.{mjs,ts}"],
        },
      },
      "packages/*",
    ],
  },
});
