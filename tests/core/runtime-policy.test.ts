import { describe, expect, it } from "vitest";

import {
  CLAUDE_HOOK_TIMEOUT_MS,
  NTFY_ATTEMPT_TIMEOUT_MS,
  NTFY_RETRY_DELAY_MS,
} from "../../src/core/runtime-policy.js";

describe("runtime timeout policy", () => {
  it("leaves output margin after two delivery attempts under every native hook timeout", () => {
    const shortestNativeHookTimeoutMs = 10_000;
    const requiredProcessOutputMarginMs = 1_500;
    const worstCaseDeliveryMs =
      NTFY_ATTEMPT_TIMEOUT_MS * 2 + NTFY_RETRY_DELAY_MS;

    expect(worstCaseDeliveryMs).toBeLessThan(CLAUDE_HOOK_TIMEOUT_MS);
    expect(worstCaseDeliveryMs).toBeLessThan(shortestNativeHookTimeoutMs);
    expect(shortestNativeHookTimeoutMs - worstCaseDeliveryMs).toBeGreaterThanOrEqual(
      requiredProcessOutputMarginMs,
    );
  });
});
