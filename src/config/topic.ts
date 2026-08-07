import { randomInt } from "node:crypto";

export const FRIENDLY_TOPIC_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
type RandomIndex = (maxExclusive: number) => number;

export function generateFriendlyTopic(nextIndex: RandomIndex = randomInt): string {
  let suffix = "";
  for (let index = 0; index < 12; index += 1) {
    const character = FRIENDLY_TOPIC_ALPHABET[nextIndex(FRIENDLY_TOPIC_ALPHABET.length)];
    if (character === undefined) throw new Error("random topic index is out of range");
    suffix += character;
  }
  return `Noutify-${suffix}`;
}
