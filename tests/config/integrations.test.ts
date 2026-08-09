import { describe, expect, it } from "vitest";

import {
  normalizeIntegrations,
  parseAgentId,
} from "../../src/config/integrations.js";
import type { IntegrationConfig } from "../../src/config/integrations.js";

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

  it("rejects duplicate agent identities", () => {
    expect(() =>
      normalizeIntegrations([
        { agent: "codex", mode: "native" },
        { agent: "codex", mode: "native" },
      ]),
    ).toThrow("duplicate integration agent: codex");
  });

  it("rejects a native agent configured for memory mode", () => {
    expect(() =>
      normalizeIntegrations([{ agent: "codex", mode: "memory" }]),
    ).toThrow("native agent must use native mode: codex");
  });

  it("rejects a generic agent configured for native mode", () => {
    expect(() =>
      normalizeIntegrations([{ agent: "generic:cursor", mode: "native" }]),
    ).toThrow("generic agent must use memory mode: generic:cursor");
  });

  it("rejects unexpected integration keys", () => {
    const integration = {
      agent: "codex" as const,
      mode: "native" as const,
      unsupported: true,
    };

    expect(() => normalizeIntegrations([integration])).toThrow(
      "integration contains unexpected field: unsupported",
    );
  });

  it("rejects non-string integration paths", () => {
    expect(() =>
      normalizeIntegrations([
        {
          agent: "codex",
          mode: "native",
          path: 1,
        } as unknown as IntegrationConfig,
      ]),
    ).toThrow("integration path must be a string");
  });
});
