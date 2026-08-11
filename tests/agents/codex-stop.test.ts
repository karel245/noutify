import { describe, expect, it } from "vitest";

import { parseCodexStopPayload } from "../../src/agents/codex/stop.js";

describe("parseCodexStopPayload", () => {
  it("accepts a Stop payload while ignoring transcript and message fields", () => {
    expect(
      parseCodexStopPayload(
        JSON.stringify({
          hook_event_name: "Stop",
          stop_hook_active: false,
          transcript_path: "C:/private/transcript.jsonl",
          message: "do-not-read",
        }),
      ),
    ).toEqual({ valid: true, recursive: false });
  });

  it("suppresses recursive Stop callbacks", () => {
    expect(
      parseCodexStopPayload('{"hook_event_name":"Stop","stop_hook_active":true}'),
    ).toEqual({ valid: true, recursive: true });
  });

  it("rejects malformed and non-Stop events", () => {
    expect(parseCodexStopPayload("not-json")).toEqual({
      valid: false,
      recursive: false,
    });
    expect(parseCodexStopPayload('{"hook_event_name":"BeforeTool"}')).toEqual({
      valid: false,
      recursive: false,
    });
  });
});
