import { createWaitingNotification } from "../../core/waiting-notification.js";
import type { Notification } from "../../core/types.js";

export interface ClaudeStopPayload {
  stopHookActive: boolean;
}

export interface ClaudeStopContext {
  projectName: string;
  send: (notification: Notification) => Promise<unknown>;
}

export function parseClaudeStopPayload(input: string): ClaudeStopPayload {
  if (!input.trim()) {
    return { stopHookActive: false };
  }

  try {
    const parsed: unknown = JSON.parse(input);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        stopHookActive:
          "stop_hook_active" in parsed && parsed.stop_hook_active === true,
      };
    }
  } catch {
    // Malformed hook input still represents a turn that returned to the user.
  }

  return { stopHookActive: false };
}

export async function handleClaudeStop(
  input: string,
  context: ClaudeStopContext,
): Promise<void> {
  try {
    const payload = parseClaudeStopPayload(input);
    if (payload.stopHookActive) {
      return;
    }

    await context.send(createWaitingNotification(context.projectName));
  } catch {
    // Notification delivery is best-effort and never alters Claude's Stop flow.
  }
}
