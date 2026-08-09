import type { WaitingHookPayload } from "../waiting-hook.js";

export function parseClaudeStopPayload(input: string): WaitingHookPayload {
  if (!input.trim()) {
    return { recursive: false, valid: false };
  }

  try {
    const parsed: unknown = JSON.parse(input);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return {
        recursive:
          "stop_hook_active" in parsed && parsed.stop_hook_active === true,
        valid: true,
      };
    }
  } catch {
    // Invalid hook input must not create a waiting notification.
  }

  return { recursive: false, valid: false };
}
