import { toolRegistry } from "@ask-llm/shared";
import { askGrokTool } from "./ask-grok.tool.js";
import { pingTool } from "./simple-tools.js";

toolRegistry.push(askGrokTool, pingTool);

export { executeTool, getPromptMessage, toolRegistry } from "@ask-llm/shared";
