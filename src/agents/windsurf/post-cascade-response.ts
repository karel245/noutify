import type { WaitingHookPayload } from "../waiting-hook.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWindsurfPostResponsePayload(
  input: string,
): WaitingHookPayload {
  try {
    const value: unknown = JSON.parse(input);
    return {
      valid:
        isRecord(value) &&
        value.agent_action_name === "post_cascade_response",
      recursive: false,
    };
  } catch {
    return { valid: false, recursive: false };
  }
}
