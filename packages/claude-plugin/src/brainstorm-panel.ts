import { executeCodexCLI } from "@ask-llm/codex-mcp/executor";
import { executeGrok } from "@ask-llm/grok-mcp/executor";
import { executeCursorAgent } from "@ask-llm/mcp/cursor";

export const BRAINSTORM_PANEL_PROVIDERS = ["grok", "codex"] as const;
export type BrainstormPanelProvider = (typeof BRAINSTORM_PANEL_PROVIDERS)[number];
export type BrainstormPanelHarness = "cursor-agent" | "grok-cli" | "xai-api" | "codex-cli";

export type BrainstormModelVerification =
  | "observed-exact"
  | "observed-alias"
  | "selected-unverified"
  | "mismatch"
  | "fallback";

export interface BrainstormParticipant {
  provider: BrainstormPanelProvider;
  harness: BrainstormPanelHarness;
  model: string;
}

export interface BrainstormParticipantResult extends BrainstormParticipant {
  status: "fulfilled" | "rejected";
  requestedModel: string;
  observedModel?: string;
  reportedModel?: string;
  modelVerification?: BrainstormModelVerification;
  attributionNote?: string;
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

export function isSameProductResolution(requested: string, observed: string): boolean {
  const requestedId = requested.trim().toLowerCase();
  const observedId = observed.trim().toLowerCase();
  if (requestedId === observedId) return true;
  if (!observedId.startsWith(`${requestedId}-`)) return false;
  return /^[0-9][0-9.-]*$/.test(observedId.slice(requestedId.length + 1));
}

interface ObservedAttribution {
  modelVerification: "observed-exact" | "observed-alias";
  attributionNote: string;
}

function classifyObservedModel(participant: BrainstormParticipant, observedModel: string): ObservedAttribution {
  const identity = `${participant.provider} via ${participant.harness}`;
  if (observedModel.trim().toLowerCase() === participant.model.trim().toLowerCase()) {
    return {
      modelVerification: "observed-exact",
      attributionNote: `${identity} reported served model "${observedModel}", matching the requested ID.`,
    };
  }
  if (isSameProductResolution(participant.model, observedModel)) {
    return {
      modelVerification: "observed-alias",
      attributionNote: `${identity} served "${observedModel}" for requested "${participant.model}" (disclosed provider-side alias/snapshot resolution of the same model; the requested ID was sent unchanged and was not rewritten).`,
    };
  }
  throw new Error(
    `${identity} requested exact model "${participant.model}" but reported "${observedModel}". The response is excluded from two-model consensus; no additional route was attempted.`,
  );
}

function selectedOnlyNote(participant: BrainstormParticipant, detail: string): string {
  return `${participant.provider} via ${participant.harness} ran the requested ID "${participant.model}" (${detail}); the harness does not independently confirm the served catalog model, so this attribution is selected-only and unverifiable, not an observed actual model.`;
}

async function invokeParticipant(
  participant: BrainstormParticipant,
  prompt: string,
  signal: AbortSignal | undefined,
  onProgress: ((message: string) => void) | undefined,
): Promise<BrainstormParticipantResult> {
  const identity = `${participant.provider} via ${participant.harness} (${participant.model})`;
  const progress = onProgress ? (message: string) => onProgress(`[${identity}] ${message}`) : undefined;
  const base = { ...participant, requestedModel: participant.model };
  let observedModel: string | undefined;
  let reportedModel: string | undefined;
  let modelVerification: BrainstormModelVerification | undefined;
  try {
    if (participant.harness === "cursor-agent") {
      const result = await executeCursorAgent({
        provider: participant.provider,
        model: participant.model,
        prompt,
        signal,
        onProgress: progress,
      });
      reportedModel = result.reportedModel;
      if (result.usage.fellBack) {
        modelVerification = "fallback";
        throw new Error(
          `Cursor Agent reported a model fallback for requested "${participant.model}". The response is excluded from two-model consensus.`,
        );
      }
      if (result.model !== participant.model) {
        modelVerification = "mismatch";
        throw new Error(
          `Cursor Agent ran "${result.model}" instead of requested "${participant.model}". The response is excluded from two-model consensus; no additional route was attempted.`,
        );
      }
      modelVerification = "selected-unverified";
      return {
        ...base,
        reportedModel,
        modelVerification,
        attributionNote: selectedOnlyNote(
          participant,
          reportedModel
            ? `Cursor echoed the requested ID and reported display label "${reportedModel}", which is a label and not a catalog ID`
            : "Cursor echoed the requested ID and reported no display label",
        ),
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
      if (result.usage?.fellBack) {
        modelVerification = "fallback";
        throw new Error(
          `${participant.harness} reported a model fallback for requested "${participant.model}". The response is excluded from two-model consensus.`,
        );
      }
      observedModel = result.model;
      let observed: ObservedAttribution;
      try {
        observed = classifyObservedModel(participant, observedModel);
      } catch (error) {
        modelVerification = "mismatch";
        throw error;
      }
      modelVerification = observed.modelVerification;
      return {
        ...base,
        observedModel,
        modelVerification,
        attributionNote: observed.attributionNote,
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
    if (result.usage?.fellBack) {
      modelVerification = "fallback";
      throw new Error(
        `Codex CLI reported a model fallback to "${result.usage.model}" for requested "${participant.model}". The response is excluded from two-model consensus.`,
      );
    }
    if (result.usage && result.usage.model !== participant.model) {
      modelVerification = "mismatch";
      throw new Error(
        `Codex CLI ran "${result.usage.model}" instead of requested "${participant.model}". The response is excluded from two-model consensus; no additional route was attempted.`,
      );
    }
    modelVerification = "selected-unverified";
    return {
      ...base,
      modelVerification,
      attributionNote: selectedOnlyNote(
        participant,
        result.usage
          ? "Codex CLI echoed the requested ID with no fallback"
          : "served from the Codex response cache keyed by the requested ID, which stores only no-fallback responses",
      ),
      response: result.response,
      status: "fulfilled",
    };
  } catch (error) {
    return {
      ...base,
      observedModel,
      reportedModel,
      modelVerification,
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
