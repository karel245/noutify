import { describe, expect, it } from "vitest";

import type { Notification } from "../../src/core/types.js";
import {
  handleClaudeStop,
  parseClaudeStopPayload,
} from "../../src/agents/claude-code/stop.js";

describe("parseClaudeStopPayload", () => {
  it("extracts only the recursive Stop flag", () => {
    expect(
      parseClaudeStopPayload(
        JSON.stringify({
          stop_hook_active: true,
          transcript_path: "C:/private/transcript.jsonl",
          tool_input: { token: "do-not-read" },
        }),
      ),
    ).toEqual({ stopHookActive: true });
  });

  it("uses a safe fallback for malformed input", () => {
    expect(parseClaudeStopPayload("not-json")).toEqual({
      stopHookActive: false,
    });
    expect(parseClaudeStopPayload("")).toEqual({ stopHookActive: false });
  });
});

describe("handleClaudeStop", () => {
  it("does not notify a recursively activated Stop hook", async () => {
    const sent: Notification[] = [];

    await handleClaudeStop('{"stop_hook_active":true}', {
      projectName: "Demo",
      language: "en",
      send: async (notification) => {
        sent.push(notification);
      },
    });

    expect(sent).toEqual([]);
  });

  it("sends Spanish WAITING copy without transcript content", async () => {
    const sent: Notification[] = [];

    await handleClaudeStop(
      '{"stop_hook_active":false,"transcript_path":"C:/private/transcript.jsonl"}',
      {
        projectName: "Demo",
        language: "es",
        send: async (notification) => {
          sent.push(notification);
        },
      },
    );

    expect(sent).toEqual([
      {
        title: "Agente en espera",
        message: "Demo: El agente terminó su respuesta y espera instrucciones.",
        tags: ["speech_balloon", "hourglass"],
        priority: "default",
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain("transcript.jsonl");
  });

  it("never throws when delivery fails", async () => {
    await expect(
      handleClaudeStop("not-json", {
        projectName: "Demo",
        language: "en",
        send: async () => {
          throw new Error("provider unavailable");
        },
      }),
    ).resolves.toBeUndefined();
  });
});
