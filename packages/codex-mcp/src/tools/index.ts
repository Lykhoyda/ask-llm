import { toolRegistry } from "@ask-llm/shared";
import { askCodexTool } from "./ask-codex.tool.js";
import { askCodexEditTool } from "./ask-codex-edit.tool.js";
import { askCodexWriteTool } from "./ask-codex-write.tool.js";
import { pingTool } from "./simple-tools.js";

toolRegistry.push(askCodexTool, askCodexWriteTool, askCodexEditTool, pingTool);

export { executeTool, getPromptMessage, toolRegistry } from "@ask-llm/shared";
