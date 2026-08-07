import { describe, expect, it } from "vitest";

import { createWaitingNotification } from "../../src/core/waiting-notification.js";

describe("createWaitingNotification", () => {
  it("uses English copy when English is selected", () => {
    expect(createWaitingNotification("Demo", "en")).toMatchObject({
      title: "Agent waiting",
      message:
        "Demo: The agent finished its response and is waiting for instructions.",
    });
  });

  it("uses Spanish copy when Spanish is selected", () => {
    expect(createWaitingNotification("Demo", "es")).toMatchObject({
      title: "Agente en espera",
      message: "Demo: El agente terminó su respuesta y espera instrucciones.",
    });
  });

  it("never claims that work completed", () => {
    const result = createWaitingNotification("Demo", "en");

    expect(result.message.toLowerCase()).not.toMatch(
      /completed|validated|finished the task/,
    );
  });
});
