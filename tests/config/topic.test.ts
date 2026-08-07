import { describe, expect, it } from "vitest";

import {
  FRIENDLY_TOPIC_ALPHABET,
  generateFriendlyTopic,
} from "../../src/config/topic.js";

describe("friendly topics", () => {
  it("maps injected indexes to the approved topic alphabet", () => {
    let index = 0;

    const topic = generateFriendlyTopic(() => index++);

    expect(topic).toBe("Noutify-23456789abcd");
  });

  it("generates a topic with a twelve-character friendly suffix", () => {
    const topic = generateFriendlyTopic(() => 0);

    expect(topic).toMatch(/^Noutify-[23456789abcdefghjkmnpqrstuvwxyz]{12}$/);
  });

  it("excludes ambiguous characters from generated suffixes", () => {
    const topic = generateFriendlyTopic(() => FRIENDLY_TOPIC_ALPHABET.length - 1);

    expect(topic.slice("Noutify-".length)).not.toMatch(/[01ilo]/);
  });
});
