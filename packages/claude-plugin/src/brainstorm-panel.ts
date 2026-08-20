import { executeCodexCLI } from "@ask-llm/codex-mcp/executor";
import { executeGrok } from "@ask-llm/grok-mcp/executor";
import { executeCursorAgent } from "@ask-llm/mcp/cursor";

export const BRAINSTORM_PANEL_PROVIDERS = ["grok", "codex"] as const;
export type BrainstormPanelProvider = (typeof BRAINSTORM_PANEL_PROVIDERS)[number];
export type BrainstormPanelHarness = "cursor-agent" | "grok-cli" | "xai-api" | "codex-cli";

export interface BrainstormParticipant {
  provider: BrainstormPanelProvider;
  harness: BrainstormPanelHarness;
  model: string;
}

export interface BrainstormParticipantResult extends BrainstormParticipant {
  status: "fulfilled" | "rejected";
  requestedModel: string;
  actualModel?: string;
  reportedModel?: string;
  response?: string;
  error?: string;
}

export interface BrainstormPanelReport {
  panel: "grok+gpt-5.6-sol";
  status: "complete" | "partial" | "failed";
  consensusEligible: boolean;
  synthesisRule: string;
  participants: BrainstormParticipantResult[];
}

const SYNTHESIS_RULE =
  "Call a point two-model consensus only when both requested participants fulfilled successfully and independently stated it. On any participant failure, label the run partial and attribute surviving insights to that participant only.";

function routeAllowed(participant: BrainstormParticipant): boolean {
  if (participant.provider === "grok") {
    return ["cursor-agent", "grok-cli", "xai-api"].includes(participant.harness);
  }
  return ["cursor-agent", "codex-cli"].includes(participant.harness);
}

export function parseBrainstormParticipant(spec: string): BrainstormParticipant {
  const match = spec.match(/^(grok|codex)@(cursor-agent|grok-cli|xai-api|codex-cli):(.+)$/);
  if (!match) {
    throw new Error(
      `Invalid brainstorm participant "${spec}". Use provider@harness:exact-model-id (for example grok@cursor-agent:cursor-grok-4.6-high).`,
    );
  }
  const participant = {
    provider: match[1] as BrainstormPanelProvider,
    harness: match[2] as BrainstormPanelHarness,
    model: match[3].trim(),
  };
  if (!participant.model || participant.model.toLowerCase() === "auto") {
    throw new Error(`Participant "${spec}" requires an exact non-Auto model ID from the selected harness catalog.`);
  }
  if (!routeAllowed(participant)) {
    throw new Error(
      `Unsupported brainstorm route ${participant.provider}@${participant.harness}. Harness, provider, and model are not interchangeable; no substitute route was selected.`,
    );
  }
  return participant;
}

export function validateBrainstormPanel(participants: BrainstormParticipant[]): void {
  if (participants.length !== 2) {
    throw new Error("The Grok + GPT-5.6 Sol panel requires exactly two participants.");
  }
  const providers = participants.map(({ provider }) => provider);
  if (new Set(providers).size !== providers.length) {
    throw new Error("The Grok + GPT-5.6 Sol panel requires one Grok participant and one Codex participant.");
  }
  for (const required of BRAINSTORM_PANEL_PROVIDERS) {
    if (!providers.includes(required)) {
      throw new Error(`The Grok + GPT-5.6 Sol panel is missing provider "${required}".`);
    }
  }
  for (const participant of participants) {
    if (!participant.model.trim() || participant.model.toLowerCase() === "auto") {
      throw new Error(`${participant.provider}@${participant.harness} requires an exact non-Auto model ID.`);
    }
    if (!routeAllowed(participant)) {
      throw new Error(
        `Unsupported brainstorm route ${participant.provider}@${participant.harness}. No provider or harness fallback was attempted.`,
      );
    }
    if (participant.provider === "codex" && !participant.model.toLowerCase().includes("gpt-5.6-sol")) {
      throw new Error(
        `The Codex participant must request an exact GPT-5.6 Sol model ID; received "${participant.model}". No model substitution was attempted.`,
      );
    }
  }
}

function exactModelFailure(participant: BrainstormParticipant, actualModel: string | undefined): Error | undefined {
  if (!actualModel) {
    return new Error(
      `${participant.provider} via ${participant.harness} did not report the actual model for requested "${participant.model}"; it is excluded from two-model consensus.`,
    );
  }
  if (actualModel !== participant.model) {
    return new Error(
      `${participant.provider} via ${participant.harness} requested exact model "${participant.model}" but reported "${actualModel}". The response is excluded from two-model consensus; no additional route was attempted.`,
    );
  }
  return undefined;
}

async function invokeParticipant(
  participant: BrainstormParticipant,
  prompt: string,
  signal: AbortSignal | undefined,
  onProgress: ((message: string) => void) | undefined,
): Promise<BrainstormParticipantResult> {
  const identity = `${participant.provider} via ${participant.harness} (${participant.model})`;
  const progress = onProgress ? (message: string) => onProgress(`[${identity}] ${message}`) : undefined;
  let actualModel: string | undefined;
  let reportedModel: string | undefined;
  try {
    if (participant.harness === "cursor-agent") {
      const result = await executeCursorAgent({
        provider: participant.provider,
        model: participant.model,
        prompt,
        signal,
        onProgress: progress,
      });
      actualModel = result.model;
      reportedModel = result.reportedModel;
      const exactFailure = exactModelFailure(participant, actualModel);
      if (exactFailure) throw exactFailure;
      return {
        ...participant,
        requestedModel: participant.model,
        actualModel,
        reportedModel,
        response: result.response,
        status: "fulfilled",
      };
    }

    if (participant.provider === "grok") {
      if (participant.harness !== "grok-cli" && participant.harness !== "xai-api") {
        throw new Error(
          `Unsupported brainstorm route ${participant.provider}@${participant.harness}. No fallback was attempted.`,
        );
      }
      const result = await executeGrok({
        prompt,
        model: participant.model,
        harness: participant.harness,
        reasoningEffort: "high",
        signal,
        onProgress: progress,
      });
      actualModel = result.model;
      const exactFailure = exactModelFailure(participant, actualModel);
      if (exactFailure) throw exactFailure;
      return {
        ...participant,
        requestedModel: participant.model,
        actualModel,
        response: result.response,
        status: "fulfilled",
      };
    }

    const result = await executeCodexCLI({
      prompt,
      model: participant.model,
      reasoningEffort: "high",
      sandbox: "read-only",
      signal,
      onProgress: progress,
    });
    if (!result.usage) {
      throw exactModelFailure(participant, undefined) as Error;
    }
    actualModel = result.usage.model;
    const exactFailure = exactModelFailure(participant, actualModel);
    if (exactFailure) throw exactFailure;
    if (result.usage.fellBack) {
      throw new Error(
        `Codex CLI reported a model fallback for requested "${participant.model}". The response is excluded from two-model consensus.`,
      );
    }
    return {
      ...participant,
      requestedModel: participant.model,
      actualModel,
      response: result.response,
      status: "fulfilled",
    };
  } catch (error) {
    return {
      ...participant,
      requestedModel: participant.model,
      actualModel,
      reportedModel,
      status: "rejected",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runBrainstormPanel(options: {
  prompt: string;
  participants: BrainstormParticipant[];
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<BrainstormPanelReport> {
  if (!options.prompt.trim()) throw new Error("The brainstorm panel requires a non-empty prompt.");
  validateBrainstormPanel(options.participants);

  const participants = await Promise.all(
    options.participants.map((participant) =>
      invokeParticipant(participant, options.prompt, options.signal, options.onProgress),
    ),
  );
  const successCount = participants.filter(({ status }) => status === "fulfilled").length;
  return {
    panel: "grok+gpt-5.6-sol",
    status: successCount === 2 ? "complete" : successCount === 1 ? "partial" : "failed",
    consensusEligible: successCount === 2,
    synthesisRule: SYNTHESIS_RULE,
    participants,
  };
}
