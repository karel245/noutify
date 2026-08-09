import { describe, expect, it, vi } from "vitest";

import { runWaitingHook } from "../../src/agents/waiting-hook.js";

describe("runWaitingHook", () => {
  it("sends localized waiting notification when all delivery gates allow a valid event", async () => {
    const send = vi.fn(async () => undefined);

    await runWaitingHook("{}", {
      agent: "codex",
      projectName: "Atlas",
      language: "es",
      enabled: true,
      confirmed: true,
      parse: () => ({ recursive: false, valid: true }),
      send,
    });

    expect(send).toHaveBeenCalledWith({
      title: "Agente en espera",
      message: "Atlas: El agente termin\u00f3 su respuesta y espera instrucciones.",
      tags: ["speech_balloon", "hourglass"],
      priority: "default",
    });
  });

  it.each([
    ["disabled", false, true, { recursive: false, valid: true }],
    ["unconfirmed", true, false, { recursive: false, valid: true }],
    ["invalid", true, true, { recursive: false, valid: false }],
    ["recursive", true, true, { recursive: true, valid: true }],
  ])("does not send a %s event", async (_label, enabled, confirmed, payload) => {
    const send = vi.fn(async () => undefined);

    await runWaitingHook("{}", {
      agent: "claude-code",
      projectName: "Atlas",
      language: "en",
      enabled,
      confirmed,
      parse: () => payload,
      send,
    });

    expect(send).not.toHaveBeenCalled();
  });

  it("swallows parser failures so a hook never fails an agent turn", async () => {
    await expect(
      runWaitingHook("{}", {
        agent: "claude-code",
        projectName: "Atlas",
        language: "en",
        enabled: true,
        confirmed: true,
        parse: () => {
          throw new Error("invalid payload");
        },
        send: async () => undefined,
      }),
    ).resolves.toBeUndefined();
  });

  it("swallows delivery failures so a hook never fails an agent turn", async () => {
    await expect(
      runWaitingHook("{}", {
        agent: "claude-code",
        projectName: "Atlas",
        language: "en",
        enabled: true,
        confirmed: true,
        parse: () => ({ recursive: false, valid: true }),
        send: async () => {
          throw new Error("provider unavailable");
        },
      }),
    ).resolves.toBeUndefined();
  });
});
