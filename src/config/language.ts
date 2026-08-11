export type NotificationLanguage = "en" | "es";

function fold(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function normalizeNotificationLanguage(value: string): NotificationLanguage {
  const normalized = fold(value);
  if (["es", "spanish", "espanol", "castellano"].includes(normalized)) return "es";
  if (["en", "english", "ingles"].includes(normalized)) return "en";
  throw new Error("supported languages: English, Spanish");
}

export function validateStoredLanguage(value: unknown): NotificationLanguage {
  if (value === undefined) return "en";
  if (value === "en" || value === "es") return value;
  throw new Error("stored language must be en or es");
}
