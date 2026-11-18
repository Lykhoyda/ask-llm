import type { ServerNotification, ServerContext } from "@modelcontextprotocol/server";
import { PROTOCOL } from "./constants.js";
import { Logger } from "./logger.js";

type ToolExtra = ServerContext;

export interface ProgressHandle {
  interval: NodeJS.Timeout;
  stop: (success: boolean) => Promise<void>;
  updateOutput: (output: string) => void;
}

async function sendProgressNotification(extra: ToolExtra, progress: number, total?: number, message?: string) {
  const progressToken = extra.mcpReq._meta?.progressToken;
  if (progressToken === undefined) return;

  try {
    const params: Record<string, unknown> = { progressToken, progress };
    if (total !== undefined) params.total = total;
    if (message) params.message = message;

    await extra.mcpReq.notify({
      method: PROTOCOL.NOTIFICATIONS.PROGRESS,
      params,
    } as ServerNotification);
  } catch (error) {
    Logger.error("Failed to send progress notification:", error);
  }
}

export function createProgressTracker(operationName: string, extra: ToolExtra, messages: string[]): ProgressHandle {
  let active = true;
  let latestOutput = "";
  let messageIndex = 0;
  let progress = 0;

  sendProgressNotification(extra, 0, undefined, `Starting ${operationName}`);

  const interval = setInterval(async () => {
    if (active) {
      progress += 1;
      const baseMessage = messages[messageIndex % messages.length];
      const outputPreview = latestOutput.slice(-150).trim();
      const msg = outputPreview ? `${baseMessage}\nOutput: ...${outputPreview}` : baseMessage;

      await sendProgressNotification(extra, progress, undefined, msg);
      messageIndex++;
    } else {
      clearInterval(interval);
    }
  }, PROTOCOL.KEEPALIVE_INTERVAL);

  return {
    interval,
    async stop(success: boolean) {
      active = false;
      clearInterval(interval);
      await sendProgressNotification(
        extra,
        100,
        100,
        success ? `${operationName} completed` : `${operationName} failed`,
      );
    },
    updateOutput(output: string) {
      latestOutput = output;
    },
  };
}
