import type { WaitingHookPayload } from "../waiting-hook.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseGeminiAfterAgentPayload(input: string): WaitingHookPayload {
  try {
    const value: unknown = JSON.parse(input);
    if (!isRecord(value) || value.hook_event_name !== "AfterAgent") {
      return { valid: false, recursive: false };
    }
    return { valid: true, recursive: value.stop_hook_active === true };
  } catch {
    return { valid: false, recursive: false };
  }
}
