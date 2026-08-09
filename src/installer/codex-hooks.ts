import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { assertSafeProjectPath } from "../core/project-path.js";

const CODEX_HOOKS_PATH = join(".codex", "hooks.json");

export interface CodexHookCommand {
  type: "command";
  command: string;
  commandWindows?: string;
}

export interface LegacyCodexHookCommand {
  command: string;
  args: string[];
  timeout: number;
}

export interface CodexHookMutation {
  changed: boolean;
}

interface CodexHooksFile {
  exists: boolean;
  path: string;
  value: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isOwnedCommand(value: unknown, command: CodexHookCommand): boolean {
  const expectedKeys = command.commandWindows === undefined
    ? ["type", "command"]
    : ["type", "command", "commandWindows"];
  return (
    isRecord(value) &&
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key)) &&
    value.type === "command" &&
    value.command === command.command &&
    value.commandWindows === command.commandWindows
  );
}

function arraysEqual(left: unknown[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isLegacyOwnedCommand(
  value: unknown,
  command: LegacyCodexHookCommand,
): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    Object.hasOwn(value, "command") &&
    Object.hasOwn(value, "args") &&
    Object.hasOwn(value, "timeout") &&
    value.command === command.command &&
    Array.isArray(value.args) &&
    arraysEqual(value.args, command.args) &&
    value.timeout === command.timeout
  );
}

function isAnyOwnedCommand(
  value: unknown,
  command: CodexHookCommand,
  legacyCommands: readonly LegacyCodexHookCommand[],
): boolean {
  return (
    isOwnedCommand(value, command) ||
    legacyCommands.some((legacy) => isLegacyOwnedCommand(value, legacy))
  );
}

async function readCodexHooks(projectRoot: string): Promise<CodexHooksFile> {
  const path = join(projectRoot, CODEX_HOOKS_PATH);
  await assertSafeProjectPath(projectRoot, path);
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return { exists: false, path, value: {} };
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("Codex hooks contain invalid JSON");
  }
  if (!isRecord(parsed)) throw new Error("Codex hooks must be an object");
  return { exists: true, path, value: parsed };
}

function stopEntries(value: Record<string, unknown>): unknown[] {
  if (!("hooks" in value)) return [];
  if (!isRecord(value.hooks)) throw new Error("Codex hooks hooks must be an object");
  if (!("Stop" in value.hooks)) return [];
  if (!Array.isArray(value.hooks.Stop)) {
    throw new Error("Codex hooks hooks.Stop must be an array");
  }
  return value.hooks.Stop;
}

function countInEntry(
  entry: unknown,
  command: CodexHookCommand,
  legacyCommands: readonly LegacyCodexHookCommand[] = [],
): number {
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) return 0;
  return entry.hooks.filter((hook) =>
    isAnyOwnedCommand(hook, command, legacyCommands)
  ).length;
}

function isOwnedEntry(entry: unknown, command: CodexHookCommand): boolean {
  return (
    isRecord(entry) &&
    Object.keys(entry).length === 1 &&
    Array.isArray(entry.hooks) &&
    entry.hooks.length === 1 &&
    isOwnedCommand(entry.hooks[0], command)
  );
}

function withoutOwnedCommand(
  entries: unknown[],
  command: CodexHookCommand,
  legacyCommands: readonly LegacyCodexHookCommand[] = [],
): unknown[] {
  return entries.flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) return [entry];
    const hooks = entry.hooks.filter(
      (hook) => !isAnyOwnedCommand(hook, command, legacyCommands),
    );
    return hooks.length > 0 ? [{ ...entry, hooks }] : [];
  });
}

async function writeCodexHooksAtomic(
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

export async function countCodexStopHooks(
  projectRoot: string,
  command: CodexHookCommand,
  legacyCommands: readonly LegacyCodexHookCommand[] = [],
): Promise<number> {
  const file = await readCodexHooks(projectRoot);
  return stopEntries(file.value).reduce<number>(
    (count, entry) => count + countInEntry(entry, command, legacyCommands),
    0,
  );
}

export async function installCodexStopHook(
  projectRoot: string,
  command: CodexHookCommand,
  legacyCommands: readonly LegacyCodexHookCommand[] = [],
): Promise<CodexHookMutation> {
  const file = await readCodexHooks(projectRoot);
  const entries = stopEntries(file.value);
  const currentCount = entries.reduce<number>(
    (count, entry) => count + countInEntry(entry, command),
    0,
  );
  const ownedCount = entries.reduce<number>(
    (count, entry) => count + countInEntry(entry, command, legacyCommands),
    0,
  );
  if (
    currentCount === 1 &&
    ownedCount === currentCount &&
    entries.filter((entry) => isOwnedEntry(entry, command)).length === 1
  ) {
    return { changed: false };
  }

  const next = structuredClone(file.value);
  const hooks = "hooks" in next ? next.hooks : {};
  if (!isRecord(hooks)) throw new Error("Codex hooks hooks must be an object");
  const stop = "Stop" in hooks ? hooks.Stop : [];
  if (!Array.isArray(stop)) throw new Error("Codex hooks hooks.Stop must be an array");
  hooks.Stop = [
    ...withoutOwnedCommand(stop, command, legacyCommands),
    { hooks: [command] },
  ];
  next.hooks = hooks;
  await writeCodexHooksAtomic(projectRoot, file.path, next);
  return { changed: true };
}

export async function uninstallCodexStopHook(
  projectRoot: string,
  command: CodexHookCommand,
  legacyCommands: readonly LegacyCodexHookCommand[] = [],
): Promise<CodexHookMutation> {
  const file = await readCodexHooks(projectRoot);
  if (!file.exists) return { changed: false };
  const entries = stopEntries(file.value);
  if (!entries.some(
    (entry) => countInEntry(entry, command, legacyCommands) > 0,
  )) {
    return { changed: false };
  }

  const next = structuredClone(file.value);
  if (!isRecord(next.hooks) || !Array.isArray(next.hooks.Stop)) {
    throw new Error("Codex hooks hooks.Stop must be an array");
  }
  const remaining = withoutOwnedCommand(
    next.hooks.Stop,
    command,
    legacyCommands,
  );
  if (remaining.length > 0) {
    next.hooks.Stop = remaining;
  } else {
    delete next.hooks.Stop;
  }
  await writeCodexHooksAtomic(projectRoot, file.path, next);
  return { changed: true };
}
