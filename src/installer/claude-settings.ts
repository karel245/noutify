import { randomUUID } from "node:crypto";
import { constants, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { CLAUDE_HOOK_TIMEOUT_MS } from "../core/runtime-policy.js";
import { assertSafeProjectPath } from "../core/project-path.js";

const SETTINGS_RELATIVE_PATH = join(".claude", "settings.local.json");

interface SettingsReadResult {
  exists: boolean;
  path: string;
  value: Record<string, unknown>;
}

export interface ClaudeHookCommand {
  command: string;
  args: string[];
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
  await assertSafeProjectPath(projectRoot, path);
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

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function arraysEqual(left: unknown[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isCurrentHandler(value: unknown, hook: ClaudeHookCommand): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["type", "command", "args", "timeout"]) &&
    value.type === "command" &&
    value.command === hook.command &&
    Array.isArray(value.args) &&
    arraysEqual(value.args, hook.args) &&
    value.timeout === CLAUDE_HOOK_TIMEOUT_MS / 1_000
  );
}

function isLegacyHandler(value: unknown, command: string): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["type", "command", "timeout"]) &&
    value.type === "command" &&
    value.command === command &&
    value.timeout === CLAUDE_HOOK_TIMEOUT_MS / 1_000
  );
}

function isOwnedHandler(
  value: unknown,
  hook: ClaudeHookCommand,
  legacyCommands: readonly string[],
): boolean {
  return (
    isCurrentHandler(value, hook) ||
    legacyCommands.some((command) => isLegacyHandler(value, command))
  );
}

function entryCommandCount(entry: unknown, hook: ClaudeHookCommand): number {
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
    return 0;
  }
  return entry.hooks.filter((handler) => isCurrentHandler(handler, hook)).length;
}

function legacyCommandCount(entry: unknown, commands: readonly string[]): number {
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
    return 0;
  }
  return entry.hooks.filter((handler) =>
    commands.some((command) => isLegacyHandler(handler, command)),
  ).length;
}

function removeOwnedHandlers(
  entries: unknown[],
  hook: ClaudeHookCommand,
  legacyCommands: readonly string[],
): unknown[] {
  return entries.flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
      return [entry];
    }
    const remainingHooks = entry.hooks.filter(
      (handler) => !isOwnedHandler(handler, hook, legacyCommands),
    );
    return remainingHooks.length > 0 ? [{ ...entry, hooks: remainingHooks }] : [];
  });
}

function currentHandler(hook: ClaudeHookCommand): Record<string, unknown> {
  return {
    type: "command",
    command: hook.command,
    args: [...hook.args],
    timeout: CLAUDE_HOOK_TIMEOUT_MS / 1_000,
  };
}

async function writeSettingsAtomic(
  projectRoot: string,
  path: string,
  value: Record<string, unknown>,
): Promise<void> {
  await assertSafeProjectPath(projectRoot, path);
  await mkdir(dirname(path), { recursive: true });
  await assertSafeProjectPath(projectRoot, path);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await assertSafeProjectPath(projectRoot, temporaryPath);
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await assertSafeProjectPath(projectRoot, temporaryPath);
    await assertSafeProjectPath(projectRoot, path);
    await rename(temporaryPath, path);
  } finally {
    await assertSafeProjectPath(projectRoot, temporaryPath);
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function backupExistingSettings(
  projectRoot: string,
  path: string,
): Promise<string> {
  const backupPath = `${path}.noutify-backup`;
  await assertSafeProjectPath(projectRoot, path);
  await assertSafeProjectPath(projectRoot, backupPath);
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
  hook: ClaudeHookCommand,
): Promise<boolean> {
  const settings = await readSettings(projectRoot);
  return stopEntries(settings.value).some(
    (entry) => entryCommandCount(entry, hook) > 0,
  );
}

export async function countClaudeStopHooks(
  projectRoot: string,
  hook: ClaudeHookCommand,
  legacyCommands: readonly string[] = [],
): Promise<number> {
  const settings = await readSettings(projectRoot);
  return stopEntries(settings.value).reduce<number>(
    (count, entry) =>
      count +
      entryCommandCount(entry, hook) +
      legacyCommandCount(entry, legacyCommands),
    0,
  );
}

async function originalContainerShape(projectRoot: string, settingsPath: string): Promise<{
  hadHooks: boolean;
  hadStop: boolean;
}> {
  try {
    await assertSafeProjectPath(projectRoot, `${settingsPath}.noutify-backup`);
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
  hook: ClaudeHookCommand,
  legacyCommands: readonly string[] = [],
): Promise<HookInstallResult> {
  const settings = await readSettings(projectRoot);
  const entries = stopEntries(settings.value);
  const currentCount = entries.reduce<number>(
    (count, entry) => count + entryCommandCount(entry, hook),
    0,
  );
  const legacyCount = entries.reduce<number>(
    (count, entry) => count + legacyCommandCount(entry, legacyCommands),
    0,
  );
  if (currentCount === 1 && legacyCount === 0) {
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
    ...removeOwnedHandlers(existingStop, hook, legacyCommands),
    { hooks: [currentHandler(hook)] },
  ];
  next.hooks = hooks;

  const backupPath = settings.exists
    ? await backupExistingSettings(projectRoot, settings.path)
    : null;
  await writeSettingsAtomic(projectRoot, settings.path, next);
  return { changed: true, backupPath };
}

export async function uninstallClaudeStopHook(
  projectRoot: string,
  hook: ClaudeHookCommand,
  legacyCommands: readonly string[] = [],
): Promise<HookUninstallResult> {
  const settings = await readSettings(projectRoot);
  if (!settings.exists) {
    return { changed: false };
  }

  const entries = stopEntries(settings.value);
  if (
    !entries.some(
      (entry) =>
        entryCommandCount(entry, hook) > 0 ||
        legacyCommandCount(entry, legacyCommands) > 0,
    )
  ) {
    return { changed: false };
  }

  const next = structuredClone(settings.value);
  if (!isRecord(next.hooks) || !Array.isArray(next.hooks.Stop)) {
    throw new Error("Claude settings hooks.Stop must be an array");
  }

  const filteredEntries = removeOwnedHandlers(
    next.hooks.Stop,
    hook,
    legacyCommands,
  );
  const originalShape = await originalContainerShape(projectRoot, settings.path);

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

  await writeSettingsAtomic(projectRoot, settings.path, next);
  return { changed: true };
}
