import { describe, expect, it } from "vitest";

import { parseWindsurfPostResponsePayload } from "../../src/agents/windsurf/post-cascade-response.js";

describe("parseWindsurfPostResponsePayload", () => {
  it("accepts only the exact post-response event without exposing payload fields", () => {
    expect(
      parseWindsurfPostResponsePayload(
        JSON.stringify({
          agent_action_name: "post_cascade_response",
          tool_info: { response: "private response" },
          workspace_root: "C:/spoofed/project",
        }),
      ),
    ).toEqual({ valid: true, recursive: false });
  });

  it.each([
    '{"agent_action_name":"pre_cascade_response"}',
    '{"agent_action_name":"POST_CASCADE_RESPONSE"}',
    '{"agent_action_name":42}',
    '{"tool_info":{"response":"private response"}}',
    "not-json",
    "[]",
  ])("rejects a non-matching payload without recursion: %s", (input) => {
    expect(parseWindsurfPostResponsePayload(input)).toEqual({
      valid: false,
      recursive: false,
    });
  });
});
