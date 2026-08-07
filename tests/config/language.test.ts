import { describe, expect, it } from "vitest";

import {
  normalizeNotificationLanguage,
  validateStoredLanguage,
} from "../../src/config/language.js";

describe("notification language", () => {
  it.each(["es", "ESPAÑOL", "castellano"])(
    "normalizes %s to Spanish",
    (value) => {
      expect(normalizeNotificationLanguage(value)).toBe("es");
    },
  );

  it.each(["en", "English", "inglés"])(
    "normalizes %s to English",
    (value) => {
      expect(normalizeNotificationLanguage(value)).toBe("en");
    },
  );

  it("rejects unsupported language names", () => {
    expect(() => normalizeNotificationLanguage("français")).toThrow(
      "supported languages: English, Spanish",
    );
  });

  it("defaults a missing stored language to English", () => {
    expect(validateStoredLanguage(undefined)).toBe("en");
  });

  it("rejects persisted language aliases", () => {
    expect(() => validateStoredLanguage("spanish")).toThrow(
      "stored language must be en or es",
    );
  });
});
