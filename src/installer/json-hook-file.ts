import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { assertSafeProjectPath } from "../core/project-path.js";

export interface JsonHookFileSpec<T> {
  relativePath: string;
  arrayPath: readonly string[];
  owned: T;
  isOwned(value: unknown): boolean;
  errorLabel?: string;
}

export interface JsonHookInspection {
  installed: boolean;
  count: number;
}

export interface JsonHookMutation {
  changed: boolean;
}

interface JsonHookFile {
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

function labelFor(spec: JsonHookFileSpec<unknown>): string {
  return spec.errorLabel ?? "JSON hook file";
}

function arrayPathLabel(spec: JsonHookFileSpec<unknown>): string {
  return `${labelFor(spec)} ${spec.arrayPath.join(".")}`;
}

function requireArrayPath(spec: JsonHookFileSpec<unknown>): void {
  if (spec.arrayPath.length === 0) {
    throw new Error("JSON hook array path must not be empty");
  }
}

async function readJsonHookFile<T>(
  projectRoot: string,
  spec: JsonHookFileSpec<T>,
): Promise<JsonHookFile> {
  requireArrayPath(spec);
  const path = join(projectRoot, spec.relativePath);
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
    throw new Error(`${labelFor(spec)} contains invalid JSON`);
  }
  if (!isRecord(parsed)) throw new Error(`${labelFor(spec)} must be an object`);
  return { exists: true, path, value: parsed };
}

function existingArray<T>(
  value: Record<string, unknown>,
  spec: JsonHookFileSpec<T>,
): unknown[] | undefined {
  let container = value;
  for (let index = 0; index < spec.arrayPath.length - 1; index += 1) {
    const key = spec.arrayPath[index] as string;
    if (!Object.hasOwn(container, key)) return undefined;
    const next = container[key];
    if (!isRecord(next)) {
      throw new Error(`${labelFor(spec)} ${spec.arrayPath.slice(0, index + 1).join(".")} must be an object`);
    }
    container = next;
  }
  const finalKey = spec.arrayPath.at(-1) as string;
  if (!Object.hasOwn(container, finalKey)) return undefined;
  const entries = container[finalKey];
  if (!Array.isArray(entries)) throw new Error(`${arrayPathLabel(spec)} must be an array`);
  return entries;
}

function ensureArray<T>(
  value: Record<string, unknown>,
  spec: JsonHookFileSpec<T>,
): unknown[] {
  let container = value;
  for (let index = 0; index < spec.arrayPath.length - 1; index += 1) {
    const key = spec.arrayPath[index] as string;
    if (!Object.hasOwn(container, key)) {
      const next: Record<string, unknown> = {};
      container[key] = next;
      container = next;
      continue;
    }
    const next = container[key];
    if (!isRecord(next)) {
      throw new Error(`${labelFor(spec)} ${spec.arrayPath.slice(0, index + 1).join(".")} must be an object`);
    }
    container = next;
  }
  const finalKey = spec.arrayPath.at(-1) as string;
  if (!Object.hasOwn(container, finalKey)) {
    const entries: unknown[] = [];
    container[finalKey] = entries;
    return entries;
  }
  const entries = container[finalKey];
  if (!Array.isArray(entries)) throw new Error(`${arrayPathLabel(spec)} must be an array`);
  return entries;
}

function parentForExistingArray<T>(
  value: Record<string, unknown>,
  spec: JsonHookFileSpec<T>,
): Record<string, unknown> | undefined {
  let container = value;
  for (let index = 0; index < spec.arrayPath.length - 1; index += 1) {
    const key = spec.arrayPath[index] as string;
    if (!Object.hasOwn(container, key)) return undefined;
    const next = container[key];
    if (!isRecord(next)) {
      throw new Error(`${labelFor(spec)} ${spec.arrayPath.slice(0, index + 1).join(".")} must be an object`);
    }
    container = next;
  }
  return container;
}

async function writeJsonHookFileAtomic(
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

export async function preflightJsonHook<T>(
  projectRoot: string,
  spec: JsonHookFileSpec<T>,
): Promise<void> {
  const file = await readJsonHookFile(projectRoot, spec);
  existingArray(file.value, spec);
}

export async function inspectJsonHook<T>(
  projectRoot: string,
  spec: JsonHookFileSpec<T>,
): Promise<JsonHookInspection> {
  const file = await readJsonHookFile(projectRoot, spec);
  const entries = existingArray(file.value, spec) ?? [];
  const count = entries.filter((entry) => spec.isOwned(entry)).length;
  return { installed: count === 1, count };
}

export async function installJsonHook<T>(
  projectRoot: string,
  spec: JsonHookFileSpec<T>,
): Promise<JsonHookMutation> {
  const file = await readJsonHookFile(projectRoot, spec);
  const entries = existingArray(file.value, spec) ?? [];
  if (entries.filter((entry) => spec.isOwned(entry)).length === 1) {
    return { changed: false };
  }

  const next = structuredClone(file.value);
  const nextEntries = ensureArray(next, spec);
  const normalized = nextEntries.filter((entry) => !spec.isOwned(entry));
  normalized.push(spec.owned);
  const parent = parentForExistingArray(next, spec);
  if (parent === undefined) throw new Error("JSON hook array path is unavailable");
  parent[spec.arrayPath.at(-1) as string] = normalized;
  await writeJsonHookFileAtomic(projectRoot, file.path, next);
  return { changed: true };
}

export async function uninstallJsonHook<T>(
  projectRoot: string,
  spec: JsonHookFileSpec<T>,
): Promise<JsonHookMutation> {
  const file = await readJsonHookFile(projectRoot, spec);
  if (!file.exists) return { changed: false };
  const entries = existingArray(file.value, spec);
  if (entries === undefined || !entries.some((entry) => spec.isOwned(entry))) {
    return { changed: false };
  }

  const next = structuredClone(file.value);
  const parent = parentForExistingArray(next, spec);
  if (parent === undefined) throw new Error("JSON hook array path is unavailable");
  const finalKey = spec.arrayPath.at(-1) as string;
  const nextEntries = parent[finalKey];
  if (!Array.isArray(nextEntries)) throw new Error(`${arrayPathLabel(spec)} must be an array`);
  const remaining = nextEntries.filter((entry) => !spec.isOwned(entry));
  if (remaining.length === 0) {
    delete parent[finalKey];
  } else {
    parent[finalKey] = remaining;
  }
  await writeJsonHookFileAtomic(projectRoot, file.path, next);
  return { changed: true };
}
