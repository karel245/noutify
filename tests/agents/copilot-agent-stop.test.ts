import { describe, expect, it } from "vitest";

import { parseCopilotAgentStopPayload } from "../../src/agents/copilot-cli/agent-stop.js";

describe("parseCopilotAgentStopPayload", () => {
  it("accepts the native camelCase end-turn payload without reading private fields", () => {
    expect(
      parseCopilotAgentStopPayload(
        JSON.stringify({
          stopReason: "end_turn",
          stop_hook_active: false,
          prompt: "private prompt",
          transcriptPath: "C:/private/transcript.jsonl",
        }),
      ),
    ).toEqual({ valid: true, recursive: false });
  });

  it("accepts the VS Code-compatible Stop end-turn payload", () => {
    expect(
      parseCopilotAgentStopPayload(
        '{"hook_event_name":"Stop","stop_reason":"end_turn","stop_hook_active":false}',
      ),
    ).toEqual({ valid: true, recursive: false });
  });

  it.each([
    ["native recursion", '{"stopReason":"end_turn","stop_hook_active":true}'],
    [
      "VS Code recursion",
      '{"hook_event_name":"Stop","stop_reason":"end_turn","stop_hook_active":true}',
    ],
  ])("suppresses %s", (_label, input) => {
    expect(parseCopilotAgentStopPayload(input)).toEqual({
      valid: true,
      recursive: true,
    });
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["native wrong reason", '{"stopReason":"cancelled"}'],
    ["native event field", '{"stopReason":"end_turn","hookEventName":"agentStop"}'],
    [
      "conflicting mixed event",
      '{"stopReason":"end_turn","hook_event_name":"BeforeTool"}',
    ],
    [
      "matching mixed forms",
      '{"stopReason":"end_turn","hook_event_name":"Stop","stop_reason":"end_turn"}',
    ],
    ["VS Code wrong event", '{"hook_event_name":"BeforeTool","stop_reason":"end_turn"}'],
    ["VS Code wrong reason", '{"hook_event_name":"Stop","stop_reason":"cancelled"}'],
  ])("rejects %s", (_label, input) => {
    expect(parseCopilotAgentStopPayload(input)).toEqual({
      valid: false,
      recursive: false,
    });
  });
});
