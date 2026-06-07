import { toolRegistry } from "@ask-llm/shared";
import { askAntigravityTool } from "./ask-antigravity.tool.js";
import { pingTool } from "./simple-tools.js";

toolRegistry.push(askAntigravityTool, pingTool);

export { executeTool, getPromptMessage, toolRegistry } from "@ask-llm/shared";
