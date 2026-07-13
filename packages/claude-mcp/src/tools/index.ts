import { toolRegistry } from "@ask-llm/shared";
import { askClaudeTool } from "./ask-claude.tool.js";
import { pingTool } from "./simple-tools.js";

toolRegistry.push(askClaudeTool, pingTool);

export { executeTool, getPromptMessage, toolRegistry } from "@ask-llm/shared";
