import { describe, expect, it } from "vitest";

import { parseClaudeStopPayload } from "../../src/agents/claude-code/stop.js";

describe("parseClaudeStopPayload", () => {
  it("extracts a valid recursive Stop event without reading private payload fields", () => {
    expect(
      parseClaudeStopPayload(
        JSON.stringify({
          stop_hook_active: true,
          transcript_path: "C:/private/transcript.jsonl",
          tool_input: { token: "do-not-read" },
        }),
      ),
    ).toEqual({ recursive: true, valid: true });
  });

  it("marks malformed input invalid so the dispatcher cannot notify", () => {
    expect(parseClaudeStopPayload("not-json")).toEqual({
      recursive: false,
      valid: false,
    });
    expect(parseClaudeStopPayload("")).toEqual({ recursive: false, valid: false });
  });
});
