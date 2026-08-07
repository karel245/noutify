import { describe, expect, it } from "vitest";

import type { Notification } from "../../src/core/types.js";
import { sendNtfy } from "../../src/providers/ntfy.js";

const notification: Notification = {
  title: "Agent waiting",
  message: "Demo: The agent is waiting.",
  tags: ["speech_balloon", "hourglass"],
  priority: "default",
};

const config = {
  server: "https://ntfy.example/base/",
  topic: "topic_1234567890abcd",
};

describe("sendNtfy", () => {
  it("posts the notification using the ntfy HTTP contract", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      requests.push({ url: String(input), init });
      return new Response(null, { status: 200 });
    };

    const result = await sendNtfy(notification, config, {
      fetch: fakeFetch,
      sleep: async () => undefined,
    });

    expect(result).toEqual({ ok: true, attempts: 1 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://ntfy.example/base/topic_1234567890abcd",
    );
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      body: "Demo: The agent is waiting.",
      headers: {
        Title: "Agent waiting",
        Tags: "speech_balloon,hourglass",
        Priority: "default",
      },
    });
  });

  it("retries one transient network failure and then succeeds", async () => {
    let attempts = 0;
    const fakeFetch = async (): Promise<Response> => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError("network unavailable");
      }
      return new Response(null, { status: 200 });
    };

    const result = await sendNtfy(notification, config, {
      fetch: fakeFetch,
      sleep: async () => undefined,
    });

    expect(result).toEqual({ ok: true, attempts: 2 });
    expect(attempts).toBe(2);
  });

  it("does not retry a permanent HTTP failure", async () => {
    let attempts = 0;
    const fakeFetch = async (): Promise<Response> => {
      attempts += 1;
      return new Response(null, { status: 400 });
    };

    const result = await sendNtfy(notification, config, {
      fetch: fakeFetch,
      sleep: async () => undefined,
    });

    expect(result).toEqual({
      ok: false,
      attempts: 1,
      reason: "http",
      status: 400,
    });
    expect(attempts).toBe(1);
  });

  it("stops after one retry when a transient HTTP failure persists", async () => {
    let attempts = 0;
    const fakeFetch = async (): Promise<Response> => {
      attempts += 1;
      return new Response(null, { status: 503 });
    };

    const result = await sendNtfy(notification, config, {
      fetch: fakeFetch,
      sleep: async () => undefined,
    });

    expect(result).toEqual({
      ok: false,
      attempts: 2,
      reason: "http",
      status: 503,
    });
    expect(attempts).toBe(2);
  });

  it("does not retry an unexpected programming error", async () => {
    let attempts = 0;
    const fakeFetch = async (): Promise<Response> => {
      attempts += 1;
      throw new Error("unexpected implementation failure");
    };

    const result = await sendNtfy(notification, config, {
      fetch: fakeFetch,
      sleep: async () => undefined,
    });

    expect(result).toEqual({ ok: false, attempts: 1, reason: "network" });
    expect(attempts).toBe(1);
  });
});
