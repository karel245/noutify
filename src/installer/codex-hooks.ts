import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const CODEX_HOOKS_PATH = join(".codex", "hooks.json");

export interface CodexHookCommand {
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

function arraysEqual(left: unknown[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isOwnedCommand(value: unknown, command: CodexHookCommand): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    value.command === command.command &&
    Array.isArray(value.args) &&
    arraysEqual(value.args, command.args) &&
    value.timeout === command.timeout
  );
}

async function readCodexHooks(projectRoot: string): Promise<CodexHooksFile> {
  const path = join(projectRoot, CODEX_HOOKS_PATH);
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

function countInEntry(entry: unknown, command: CodexHookCommand): number {
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) return 0;
  return entry.hooks.filter((hook) => isOwnedCommand(hook, command)).length;
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
): unknown[] {
  return entries.flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) return [entry];
    const hooks = entry.hooks.filter((hook) => !isOwnedCommand(hook, command));
    return hooks.length > 0 ? [{ ...entry, hooks }] : [];
  });
}

async function writeCodexHooksAtomic(
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

export async function countCodexStopHooks(
  projectRoot: string,
  command: CodexHookCommand,
): Promise<number> {
  const file = await readCodexHooks(projectRoot);
  return stopEntries(file.value).reduce<number>(
    (count, entry) => count + countInEntry(entry, command),
    0,
  );
}

export async function installCodexStopHook(
  projectRoot: string,
  command: CodexHookCommand,
): Promise<CodexHookMutation> {
  const file = await readCodexHooks(projectRoot);
  const entries = stopEntries(file.value);
  const ownedCount = entries.reduce<number>(
    (count, entry) => count + countInEntry(entry, command),
    0,
  );
  if (ownedCount === 1 && entries.filter((entry) => isOwnedEntry(entry, command)).length === 1) {
    return { changed: false };
  }

  const next = structuredClone(file.value);
  const hooks = "hooks" in next ? next.hooks : {};
  if (!isRecord(hooks)) throw new Error("Codex hooks hooks must be an object");
  const stop = "Stop" in hooks ? hooks.Stop : [];
  if (!Array.isArray(stop)) throw new Error("Codex hooks hooks.Stop must be an array");
  hooks.Stop = [...withoutOwnedCommand(stop, command), { hooks: [command] }];
  next.hooks = hooks;
  await writeCodexHooksAtomic(file.path, next);
  return { changed: true };
}

export async function uninstallCodexStopHook(
  projectRoot: string,
  command: CodexHookCommand,
): Promise<CodexHookMutation> {
  const file = await readCodexHooks(projectRoot);
  if (!file.exists) return { changed: false };
  const entries = stopEntries(file.value);
  if (!entries.some((entry) => countInEntry(entry, command) > 0)) {
    return { changed: false };
  }

  const next = structuredClone(file.value);
  if (!isRecord(next.hooks) || !Array.isArray(next.hooks.Stop)) {
    throw new Error("Codex hooks hooks.Stop must be an array");
  }
  const remaining = withoutOwnedCommand(next.hooks.Stop, command);
  if (remaining.length > 0) {
    next.hooks.Stop = remaining;
  } else {
    delete next.hooks.Stop;
  }
  await writeCodexHooksAtomic(file.path, next);
  return { changed: true };
}
