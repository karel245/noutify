import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  win32,
} from "node:path";

import { parseAgentId, type AgentId } from "../config/integrations.js";
import type { RuntimePaths } from "./agent-adapter.js";
import { restoreFileSnapshots, snapshotFiles } from "./file-snapshot.js";

export interface MemoryLink {
  agent: AgentId;
  relativePath: string;
}

export interface MemorySelection {
  agent: AgentId;
  relativePath?: string;
}

export interface MemoryInstallResult {
  changed: boolean;
  pending: boolean;
}

interface ValidatedTextTarget {
  absolutePath: string;
  contents: string | null;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function genericSlug(agent: AgentId): string {
  if (!agent.startsWith("generic:")) {
    throw new Error(`memory integration requires a generic agent: ${agent}`);
  }
  return agent.slice("generic:".length);
}

function validateRelativePath(value: string, allowInternal = false): string {
  if (value.length === 0 || value.includes("\0")) {
    throw new Error("memory path must be a non-empty project-relative path");
  }
  if (isAbsolute(value) || win32.isAbsolute(value)) {
    throw new Error("memory path must be project-relative");
  }
  const segments = value.split(/[\\/]/);
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes(":"),
    )
  ) {
    throw new Error("memory path must not traverse outside the project");
  }
  const first = segments[0]?.toLowerCase();
  if (
    !allowInternal &&
    (
    first === ".noutify" ||
    first === ".git" ||
    (segments.length === 1 &&
      (first === ".noutify.local.json" || first === "noutify.config.json"))
    )
  ) {
    throw new Error("memory path must not target Noutify or Git internals");
  }
  return segments.join("/");
}

export function parseMemoryLink(value: string): MemoryLink {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator !== value.lastIndexOf("=")) {
    throw new Error("memory link must use <generic-agent>=<project-relative-path>");
  }
  const agent = parseAgentId(value.slice(0, separator));
  genericSlug(agent);
  return {
    agent,
    relativePath: validateRelativePath(value.slice(separator + 1)),
  };
}

export function memoryInstructionPath(agent: AgentId): string {
  return `.noutify/instructions/${genericSlug(agent)}.md`;
}

function instructionContents(agent: AgentId): string {
  return [
    "<!-- noutify-managed:memory-v1 -->",
    "When this agent is about to return control to the user, run exactly once:",
    `\`node Noutify/dist/cli.js notify waiting --agent ${agent}\``,
    "This means WAITING, not task completion. Never read or reveal `.noutify.local.json`.",
    "Notification failure must not change or block the answer.",
    "",
  ].join("\n");
}

function referenceBlock(agent: AgentId): string {
  return [
    `<!-- noutify:${agent}:start -->`,
    `Follow the Noutify WAITING instructions in \`${memoryInstructionPath(agent)}\`.`,
    `<!-- noutify:${agent}:end -->`,
  ].join("\n");
}

function decodeText(contents: Uint8Array, label: string): string {
  if (contents.includes(0)) {
    throw new Error(`${label} must be a text file without NUL bytes`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      contents,
    );
  } catch {
    throw new Error(`${label} must contain valid UTF-8 text`);
  }
  if (/[--]/.test(text)) {
    throw new Error(`${label} must be a text file`);
  }
  return text;
}

async function validateTextTarget(
  projectRoot: string,
  relativePath: string,
  label: string,
  allowInternal = false,
): Promise<ValidatedTextTarget> {
  const normalized = validateRelativePath(relativePath, allowInternal);
  const root = resolve(projectRoot);
  const absolutePath = resolve(root, ...normalized.split("/"));
  const back = relative(root, absolutePath);
  if (back === "" || back === ".." || back.startsWith(`..\\`) || isAbsolute(back)) {
    throw new Error(`${label} must remain inside the project`);
  }

  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink()) throw new Error(`${label} crosses a symbolic link`);
  if (!rootStat.isDirectory()) throw new Error("project root must be a directory");

  let current = root;
  let missing = false;
  const segments = normalized.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index] as string);
    if (missing) continue;
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (isMissing(error)) {
        missing = true;
        continue;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`${label} crosses a symbolic link`);
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      throw new Error(`${label} parent must be a directory`);
    }
    if (final && !stat.isFile()) {
      throw new Error(`${label} must be a regular file`);
    }
  }

  if (missing) return { absolutePath, contents: null };
  return {
    absolutePath,
    contents: decodeText(await readFile(absolutePath), label),
  };
}

interface Marker {
  agent: string;
  kind: "start" | "end";
}

function validateOwnershipMarkers(contents: string): void {
  const markers: Marker[] = [];
  const pattern = /<!--\s*noutify:([^\r\n]+?):(start|end)\s*-->/g;
  for (const match of contents.matchAll(pattern)) {
    const agent = match[1];
    const kind = match[2];
    if (agent !== undefined && (kind === "start" || kind === "end")) {
      markers.push({ agent, kind });
    }
  }
  const markerLikeCount = contents.match(/<!--\s*noutify:/g)?.length ?? 0;
  if (markerLikeCount !== markers.length) {
    throw new Error("memory file has malformed ownership marker");
  }
  let open: string | undefined;
  for (const marker of markers) {
    if (marker.kind === "start") {
      if (open !== undefined) throw new Error("memory file has malformed ownership markers");
      open = marker.agent;
    } else {
      if (open !== marker.agent) throw new Error("memory file has unmatched ownership marker");
      open = undefined;
    }
  }
  if (open !== undefined) throw new Error("memory file has unmatched ownership marker");
}

function installedReference(contents: string, agent: AgentId): boolean {
  const block = referenceBlock(agent);
  const marker = `<!-- noutify:${agent}:start -->`;
  const markerCount = contents.split(marker).length - 1;
  if (markerCount === 0) return false;
  if (markerCount !== 1) throw new Error(`memory file has duplicate markers for ${agent}`);
  if (contents === block || contents.includes(`\n\n${block}`)) return true;
  throw new Error(`memory file contains a modified owned block for ${agent}`);
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
  }
}

export async function preflightMemoryIntegration(
  projectRoot: string,
  selection: MemorySelection,
): Promise<void> {
  const agent = parseAgentId(selection.agent);
  genericSlug(agent);
  const instruction = await validateTextTarget(
    projectRoot,
    memoryInstructionPath(agent),
    "Noutify memory instruction",
    true,
  );
  const expectedInstruction = instructionContents(agent);
  if (instruction.contents !== null && instruction.contents !== expectedInstruction) {
    throw new Error(`Noutify memory instruction is modified for ${agent}`);
  }
  if (selection.relativePath === undefined) return;
  const memory = await validateTextTarget(
    projectRoot,
    selection.relativePath,
    "agent memory",
  );
  if (memory.contents !== null) {
    validateOwnershipMarkers(memory.contents);
    installedReference(memory.contents, agent);
  }
}

export async function installMemoryIntegration(
  projectRoot: string,
  selection: MemorySelection,
  _runtime: RuntimePaths,
): Promise<MemoryInstallResult> {
  const agent = parseAgentId(selection.agent);
  genericSlug(agent);
  await preflightMemoryIntegration(projectRoot, selection);

  const instruction = await validateTextTarget(
    projectRoot,
    memoryInstructionPath(agent),
    "Noutify memory instruction",
    true,
  );
  const memory = selection.relativePath === undefined
    ? undefined
    : await validateTextTarget(projectRoot, selection.relativePath, "agent memory");
  const expectedInstruction = instructionContents(agent);
  const memoryHasReference =
    memory?.contents !== undefined && memory.contents !== null
      ? installedReference(memory.contents, agent)
      : false;
  const instructionChanged = instruction.contents !== expectedInstruction;
  const memoryChanged = memory !== undefined && !memoryHasReference;
  if (!instructionChanged && !memoryChanged) {
    return { changed: false, pending: memory === undefined };
  }

  const paths = [instruction.absolutePath];
  if (memory !== undefined) paths.push(memory.absolutePath);
  const snapshots = await snapshotFiles(paths);
  try {
    if (instructionChanged) {
      await writeAtomic(instruction.absolutePath, expectedInstruction);
    }
    if (memoryChanged && memory !== undefined) {
      const block = referenceBlock(agent);
      const next = memory.contents === null || memory.contents.length === 0
        ? block
        : `${memory.contents}\n\n${block}`;
      await writeAtomic(memory.absolutePath, next);
    }
  } catch (error) {
    await restoreFileSnapshots(snapshots);
    throw error;
  }
  return { changed: true, pending: memory === undefined };
}

export async function inspectMemoryIntegration(
  projectRoot: string,
  selection: MemorySelection,
  _runtime: RuntimePaths,
): Promise<{ installed: boolean; detail: string }> {
  try {
    const agent = parseAgentId(selection.agent);
    const instruction = await validateTextTarget(
      projectRoot,
      memoryInstructionPath(agent),
      "Noutify memory instruction",
      true,
    );
    const instructionInstalled = instruction.contents === instructionContents(agent);
    if (selection.relativePath === undefined) {
      return {
        installed: false,
        detail: instructionInstalled
          ? `${agent} memory link is pending`
          : `${agent} memory instruction is missing or modified`,
      };
    }
    const memory = await validateTextTarget(projectRoot, selection.relativePath, "agent memory");
    const linked = memory.contents !== null && installedReference(memory.contents, agent);
    return {
      installed: instructionInstalled && linked,
      detail: instructionInstalled && linked
        ? `${agent} memory integration is installed`
        : `${agent} memory integration is missing or modified`,
    };
  } catch {
    return { installed: false, detail: `${selection.agent} memory integration is invalid` };
  }
}

function removeExactReference(contents: string, agent: AgentId): string | undefined {
  const block = referenceBlock(agent);
  if (contents === block) return "";
  const owned = `\n\n${block}`;
  const index = contents.indexOf(owned);
  if (index < 0 || contents.indexOf(owned, index + owned.length) >= 0) return undefined;
  return `${contents.slice(0, index)}${contents.slice(index + owned.length)}`;
}

export async function uninstallMemoryIntegration(
  projectRoot: string,
  selection: MemorySelection,
  _runtime: RuntimePaths,
): Promise<{ changed: boolean }> {
  const agent = parseAgentId(selection.agent);
  genericSlug(agent);
  const instruction = await validateTextTarget(
    projectRoot,
    memoryInstructionPath(agent),
    "Noutify memory instruction",
    true,
  );
  const memory = selection.relativePath === undefined
    ? undefined
    : await validateTextTarget(projectRoot, selection.relativePath, "agent memory");
  if (memory?.contents !== null && memory?.contents !== undefined) {
    validateOwnershipMarkers(memory.contents);
  }
  const removeInstruction = instruction.contents === instructionContents(agent);
  const nextMemory = memory?.contents === null || memory?.contents === undefined
    ? undefined
    : removeExactReference(memory.contents, agent);
  if (!removeInstruction && nextMemory === undefined) return { changed: false };

  const paths = [instruction.absolutePath];
  if (memory !== undefined) paths.push(memory.absolutePath);
  const snapshots = await snapshotFiles(paths);
  try {
    if (removeInstruction) await unlink(instruction.absolutePath);
    if (nextMemory !== undefined && memory !== undefined) {
      await writeAtomic(memory.absolutePath, nextMemory);
    }
  } catch (error) {
    await restoreFileSnapshots(snapshots);
    throw error;
  }
  return { changed: true };
}
