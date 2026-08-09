import { describe, expect, it } from "vitest";

import {
  normalizeIntegrations,
  parseAgentId,
} from "../../src/config/integrations.js";

describe("agent integrations", () => {
  it("accepts a canonical generic agent identifier", () => {
    expect(parseAgentId("generic:cursor")).toBe("generic:cursor");
  });

  it("rejects non-canonical generic agent identifiers", () => {
    expect(() => parseAgentId("generic:Cursor Settings")).toThrow(
      "invalid agent identifier",
    );
  });

  it("sorts valid integrations by agent identity", () => {
    expect(
      normalizeIntegrations([
        { agent: "codex", mode: "native", path: ".codex/hooks.json" },
        {
          agent: "claude-code",
          mode: "native",
          path: ".claude/settings.local.json",
        },
      ]),
    ).toEqual([
      {
        agent: "claude-code",
        mode: "native",
        path: ".claude/settings.local.json",
      },
      { agent: "codex", mode: "native", path: ".codex/hooks.json" },
    ]);
  });
});
