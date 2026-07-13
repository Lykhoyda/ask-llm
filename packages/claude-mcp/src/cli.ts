#!/usr/bin/env node

import { Logger } from "@ask-llm/shared";
import { startServer } from "./index.js";

startServer().catch((error) => {
  Logger.error("Fatal error:", error);
  process.exit(1);
});
