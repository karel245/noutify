import { describe, expect, it } from "vitest";

import {
  CLAUDE_HOOK_TIMEOUT_MS,
  NTFY_ATTEMPT_TIMEOUT_MS,
  NTFY_RETRY_DELAY_MS,
} from "../../src/core/runtime-policy.js";

describe("runtime timeout policy", () => {
  it("keeps two delivery attempts within the Claude hook timeout", () => {
    expect(NTFY_ATTEMPT_TIMEOUT_MS * 2 + NTFY_RETRY_DELAY_MS).toBeLessThan(
      CLAUDE_HOOK_TIMEOUT_MS,
    );
  });
});
