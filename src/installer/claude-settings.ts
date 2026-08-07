import { constants, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import { CLAUDE_HOOK_TIMEOUT_MS } from "../core/runtime-policy.js";

const SETTINGS_RELATIVE_PATH = join(".claude", "settings.local.json");

interface SettingsReadResult {
  exists: boolean;
  path: string;
  value: Record<string, unknown>;
}

export interface HookInstallResult {
  changed: boolean;
  backupPath: string | null;
}

export interface HookUninstallResult {
  changed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

async function readSettings(projectRoot: string): Promise<SettingsReadResult> {
  const path = join(projectRoot, SETTINGS_RELATIVE_PATH);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return { exists: false, path, value: {} };
    }
    throw error;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      throw new Error("not an object");
    }
    return { exists: true, path, value: parsed };
  } catch {
    throw new Error("Claude settings contain invalid JSON");
  }
}

function stopEntries(settings: Record<string, unknown>): unknown[] {
  if (!("hooks" in settings)) {
    return [];
  }
  if (!isRecord(settings.hooks)) {
    throw new Error("Claude settings hooks must be an object");
  }
  if (!("Stop" in settings.hooks)) {
    return [];
  }
  if (!Array.isArray(settings.hooks.Stop)) {
    throw new Error("Claude settings hooks.Stop must be an array");
  }
  return settings.hooks.Stop;
}

function isOwnedCommand(value: unknown, command: string): boolean {
  return (
    isRecord(value) &&
    value.type === "command" &&
    value.command === command
  );
}

function entryContainsCommand(entry: unknown, command: string): boolean {
  return entryCommandCount(entry, command) > 0;
}

function entryCommandCount(entry: unknown, command: string): number {
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
    return 0;
  }
  return entry.hooks.filter((hook) => isOwnedCommand(hook, command)).length;
}

async function writeSettingsAtomic(
  path: string,
  value: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function backupExistingSettings(path: string): Promise<string> {
  const backupPath = `${path}.noutify-backup`;
  try {
    await copyFile(path, backupPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (!isRecord(error) || error.code !== "EEXIST") {
      throw error;
    }
  }
  return backupPath;
}

export async function hasClaudeStopHook(
  projectRoot: string,
  command: string,
): Promise<boolean> {
  const settings = await readSettings(projectRoot);
  return stopEntries(settings.value).some((entry) =>
    entryContainsCommand(entry, command),
  );
}

export async function countClaudeStopHooks(
  projectRoot: string,
  command: string,
): Promise<number> {
  const settings = await readSettings(projectRoot);
  return stopEntries(settings.value).reduce<number>(
    (count, entry) => count + entryCommandCount(entry, command),
    0,
  );
}

async function originalContainerShape(settingsPath: string): Promise<{
  hadHooks: boolean;
  hadStop: boolean;
}> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(`${settingsPath}.noutify-backup`, "utf8"),
    );
    if (!isRecord(parsed) || !isRecord(parsed.hooks)) {
      return { hadHooks: false, hadStop: false };
    }
    return {
      hadHooks: true,
      hadStop: "Stop" in parsed.hooks,
    };
  } catch {
    return { hadHooks: false, hadStop: false };
  }
}

export async function installClaudeStopHook(
  projectRoot: string,
  command: string,
): Promise<HookInstallResult> {
  const settings = await readSettings(projectRoot);
  if (
    stopEntries(settings.value).some((entry) =>
      entryContainsCommand(entry, command),
    )
  ) {
    return { changed: false, backupPath: null };
  }

  const next = structuredClone(settings.value);
  const hooks = "hooks" in next ? next.hooks : {};
  if (!isRecord(hooks)) {
    throw new Error("Claude settings hooks must be an object");
  }
  const existingStop = "Stop" in hooks ? hooks.Stop : [];
  if (!Array.isArray(existingStop)) {
    throw new Error("Claude settings hooks.Stop must be an array");
  }
  hooks.Stop = [
    ...existingStop,
    {
      hooks: [
        {
          type: "command",
          command,
          timeout: CLAUDE_HOOK_TIMEOUT_MS / 1_000,
        },
      ],
    },
  ];
  next.hooks = hooks;

  const backupPath = settings.exists
    ? await backupExistingSettings(settings.path)
    : null;
  await writeSettingsAtomic(settings.path, next);
  return { changed: true, backupPath };
}

export async function uninstallClaudeStopHook(
  projectRoot: string,
  command: string,
): Promise<HookUninstallResult> {
  const settings = await readSettings(projectRoot);
  if (!settings.exists) {
    return { changed: false };
  }

  const entries = stopEntries(settings.value);
  if (!entries.some((entry) => entryContainsCommand(entry, command))) {
    return { changed: false };
  }

  const next = structuredClone(settings.value);
  if (!isRecord(next.hooks) || !Array.isArray(next.hooks.Stop)) {
    throw new Error("Claude settings hooks.Stop must be an array");
  }

  const filteredEntries = next.hooks.Stop.flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
      return [entry];
    }
    const remainingHooks = entry.hooks.filter(
      (hook) => !isOwnedCommand(hook, command),
    );
    return remainingHooks.length > 0 ? [{ ...entry, hooks: remainingHooks }] : [];
  });

  const originalShape = await originalContainerShape(settings.path);

  if (filteredEntries.length > 0) {
    next.hooks.Stop = filteredEntries;
  } else if (originalShape.hadStop) {
    next.hooks.Stop = [];
  } else {
    delete next.hooks.Stop;
  }
  if (Object.keys(next.hooks).length === 0 && !originalShape.hadHooks) {
    delete next.hooks;
  }

  await writeSettingsAtomic(settings.path, next);
  return { changed: true };
}
