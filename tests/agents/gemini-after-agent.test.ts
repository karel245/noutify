import { describe, expect, it } from "vitest";

import { parseGeminiAfterAgentPayload } from "../../src/agents/gemini-cli/after-agent.js";

describe("parseGeminiAfterAgentPayload", () => {
  it("accepts AfterAgent while ignoring private prompt and transcript fields", () => {
    expect(
      parseGeminiAfterAgentPayload(
        JSON.stringify({
          hook_event_name: "AfterAgent",
          stop_hook_active: false,
          prompt: "private prompt",
          prompt_response: "private response",
          transcript_path: "C:/private/transcript.jsonl",
        }),
      ),
    ).toEqual({ valid: true, recursive: false });
  });

  it("suppresses recursive AfterAgent callbacks", () => {
    expect(
      parseGeminiAfterAgentPayload(
        '{"hook_event_name":"AfterAgent","stop_hook_active":true}',
      ),
    ).toEqual({ valid: true, recursive: true });
  });

  it("rejects malformed JSON and events other than AfterAgent", () => {
    expect(parseGeminiAfterAgentPayload("not-json")).toEqual({
      valid: false,
      recursive: false,
    });
    expect(
      parseGeminiAfterAgentPayload('{"hook_event_name":"BeforeAgent"}'),
    ).toEqual({ valid: false, recursive: false });
  });
});
