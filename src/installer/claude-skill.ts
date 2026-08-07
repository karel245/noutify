import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface ClaudeSkillRuntime {
  nodePath: string;
  cliPath: string;
}

export interface ClaudeSkillResult {
  changed: boolean;
}

const SKILL_RELATIVE_PATH = join(".claude", "skills", "noutify", "SKILL.md");

function quoteArgument(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function isMissingFile(error: unknown): error is { code: "ENOENT" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function skillPath(projectRoot: string): string {
  return join(resolve(projectRoot), SKILL_RELATIVE_PATH);
}

function buildClaudeSkillVersion(
  projectRoot: string,
  runtime: ClaudeSkillRuntime,
  version: "v0" | "v1",
): string {
  const command = [
    quoteArgument(runtime.nodePath),
    quoteArgument(runtime.cliPath),
    "language",
    '"<language>"',
    "--project",
    quoteArgument(resolve(projectRoot)),
  ].join(" ");
  return `<!-- noutify-managed:${version} -->
---
name: noutify
description: Configure Noutify for this project.
argument-hint: language <english|español>
disable-model-invocation: true
---

Use \`$ARGUMENTS\` only for \`language <language>\`.

1. Accept exactly two arguments whose first value is \`language\`; otherwise show \`/noutify language <english|español>\` and stop.
2. Run the generated, quoted absolute command: \`${command}\`. Replace only \`<language>\` with the second argument. Do not run another Noutify subcommand.
3. Report the command result. Never read or print \`.noutify.local.json\` or its topic.
`;
}

export function buildClaudeSkill(
  projectRoot: string,
  runtime: ClaudeSkillRuntime,
): string {
  return buildClaudeSkillVersion(projectRoot, runtime, "v1");
}

async function readSkill(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

function isRecognizedSkill(
  contents: string,
  projectRoot: string,
  runtime: ClaudeSkillRuntime,
): boolean {
  return (
    contents === buildClaudeSkillVersion(projectRoot, runtime, "v1") ||
    contents === buildClaudeSkillVersion(projectRoot, runtime, "v0")
  );
}

async function writeSkillAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error;
    });
  }
}

export async function preflightClaudeSkill(
  projectRoot: string,
  runtime: ClaudeSkillRuntime,
): Promise<void> {
  const contents = await readSkill(skillPath(projectRoot));
  if (contents === null || isRecognizedSkill(contents, projectRoot, runtime)) {
    return;
  }
  throw new Error("Noutify Claude skill path is already occupied");
}

export async function hasClaudeSkill(
  projectRoot: string,
  runtime: ClaudeSkillRuntime,
): Promise<boolean> {
  const contents = await readSkill(skillPath(projectRoot));
  return contents === buildClaudeSkill(projectRoot, runtime);
}

export async function installClaudeSkill(
  projectRoot: string,
  runtime: ClaudeSkillRuntime,
): Promise<ClaudeSkillResult> {
  const path = skillPath(projectRoot);
  const contents = await readSkill(path);
  const current = buildClaudeSkill(projectRoot, runtime);
  if (contents === current) {
    return { changed: false };
  }
  if (contents !== null && !isRecognizedSkill(contents, projectRoot, runtime)) {
    throw new Error("Noutify Claude skill path is already occupied");
  }
  await writeSkillAtomic(path, current);
  return { changed: true };
}

export async function uninstallClaudeSkill(
  projectRoot: string,
  runtime: ClaudeSkillRuntime,
): Promise<ClaudeSkillResult> {
  const path = skillPath(projectRoot);
  const contents = await readSkill(path);
  if (
    contents === null ||
    !isRecognizedSkill(contents, projectRoot, runtime)
  ) {
    return { changed: false };
  }
  await unlink(path);
  return { changed: true };
}

export async function removeEmptyClaudeSkillDirectory(
  projectRoot: string,
): Promise<void> {
  await rmdir(dirname(skillPath(projectRoot))).catch((error: unknown) => {
    if (
      isMissingFile(error) ||
      (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOTEMPTY")
    ) {
      return;
    }
    throw error;
  });
}
