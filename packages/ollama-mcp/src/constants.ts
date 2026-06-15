export const OLLAMA_HOST_ENV = "OLLAMA_HOST";
export const DEFAULT_BASE_URL = "http://localhost:11434";

export const MODELS = {
  // Ollama is local — the user explicitly pulls the model they want, so there is no
  // automatic fallback to a different model. Override the default via ASK_OLLAMA_MODEL.
  DEFAULT: process.env.ASK_OLLAMA_MODEL || "qwen3.6:27b",
};

export const API = {
  CHAT: "/api/chat",
  TAGS: "/api/tags",
} as const;

export const ERROR_MESSAGES = {
  MODEL_NOT_FOUND_SIGNALS: ["not found", "try pulling", "does not exist"],
  NO_PROMPT_PROVIDED:
    "Please provide a prompt for analysis. Ask general questions or describe the code you want reviewed.",
  TOOL_NOT_FOUND: "not found in registry",
  SERVER_UNREACHABLE: "Ollama server is not reachable. Make sure Ollama is running: https://ollama.com",
} as const;

export const STATUS_MESSAGES = {
  OLLAMA_RESPONSE: "Ollama response:",
} as const;

export const AVAILABILITY_TIMEOUT_MS = 2000;
