import type { NotificationLanguage } from "../config/language.js";
import type { AgentId } from "../config/integrations.js";
import { createWaitingNotification } from "../core/waiting-notification.js";
import type { Notification } from "../core/types.js";

export interface WaitingHookPayload {
  recursive: boolean;
  valid: boolean;
}

export interface WaitingHookContext {
  agent: AgentId;
  projectName: string;
  language: NotificationLanguage;
  enabled: boolean;
  confirmed: boolean;
  parse: (input: string) => WaitingHookPayload;
  send: (notification: Notification) => Promise<unknown>;
}

export async function runWaitingHook(
  input: string,
  context: WaitingHookContext,
): Promise<void> {
  try {
    const payload = context.parse(input);
    if (!context.enabled || !context.confirmed || !payload.valid || payload.recursive) {
      return;
    }
    await context.send(
      createWaitingNotification(context.projectName, context.language),
    );
  } catch {
    // Lifecycle notification delivery never changes the agent's turn.
  }
}
