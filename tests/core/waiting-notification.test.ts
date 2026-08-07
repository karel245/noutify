import { describe, expect, it } from "vitest";

import { createWaitingNotification } from "../../src/core/waiting-notification.js";

describe("createWaitingNotification", () => {
  it("states only that the agent is waiting", () => {
    expect(createWaitingNotification("Demo")).toEqual({
      title: "Agent waiting",
      message:
        "Demo: The agent finished its response and is waiting for the next prompt.",
      tags: ["speech_balloon", "hourglass"],
      priority: "default",
    });
  });

  it("never claims that work completed", () => {
    const result = createWaitingNotification("Demo");

    expect(result.message.toLowerCase()).not.toMatch(
      /completed|validated|finished the task/,
    );
  });
});
