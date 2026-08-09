import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertSafeProjectPath } from "../core/project-path.js";

export interface ClaudeSkillRuntime {
  nodePath: string;
  cliPath: string;
}

export interface ClaudeSkillResult {
  changed: boolean;
}

const SKILL_RELATIVE_PATH = join(".claude", "skills", "noutify", "SKILL.md");
const LAUNCHER_RELATIVE_PATH = join(
  ".claude",
  "skills",
  "noutify",
  "launcher.mjs",
);

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

function ownedPath(projectRoot: string, relativePath: string): string {
  return join(resolve(projectRoot), relativePath);
}

function validateRuntime(runtime: ClaudeSkillRuntime): void {
  if (!isAbsolute(runtime.nodePath)) {
    throw new Error("runtime nodePath must be absolute");
  }
  if (!isAbsolute(runtime.cliPath)) {
    throw new Error("runtime cliPath must be absolute");
  }
}

function buildLegacyClaudeSkillV0(
  projectRoot: string,
  runtime: ClaudeSkillRuntime,
): string {
  const command = [
    quoteArgument(runtime.nodePath),
    quoteArgument(runtime.cliPath),
    "language",
    '"<language>"',
    "--project",
    quoteArgument(resolve(projectRoot)),
  ].join(" ");
  return `<!-- noutify-managed:v0 -->
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

function buildLegacyClaudeSkillV1(
  projectRoot: string,
  runtime: ClaudeSkillRuntime,
): string {
  const command = (language: "en" | "es") => [
    quoteArgument(runtime.nodePath),
    quoteArgument(runtime.cliPath),
    "language",
    quoteArgument(language),
    "--project",
    quoteArgument(resolve(projectRoot)),
  ].join(" ");
  return `<!-- noutify-managed:v1 -->
---
name: noutify
description: Configure Noutify for this project.
argument-hint: language <english|español>
disable-model-invocation: true
---

Use \`$ARGUMENTS\` only for \`language <language>\`.

1. Accept exactly two arguments whose first value is \`language\`; otherwise show \`/noutify language <english|español>\` and stop.
2. Accept the second argument case- and accent-insensitively only as \`es\`, \`spanish\`, \`español\`, \`espanol\`, or \`castellano\` and map it to the literal \`es\`; or case- and accent-insensitively only as \`en\`, \`english\`, \`inglés\`, or \`ingles\` and map it to the literal \`en\`.
3. Unsupported or shell-active values must show \`/noutify language <english|español>\` and stop before execution. Never interpolate \`$ARGUMENTS\` or the raw second token into any shell command.
4. Run exactly one generated, quoted absolute command after that mapping: Spanish \`${command("es")}\`; English \`${command("en")}\`. Do not run another Noutify subcommand.
5. Report the command result. Never read or print \`.noutify.local.json\` or its topic.
`;
}

export function buildClaudeSkill(
  _projectRoot: string,
  _runtime: ClaudeSkillRuntime,
): string {
  return `---
name: noutify
description: Configure Noutify for this project.
argument-hint: language <english|español>
disable-model-invocation: true
---
<!-- noutify-managed:v2 -->

Use \`$ARGUMENTS\` only as text for \`language <language>\`.

1. Accept exactly two arguments whose first value is \`language\`; otherwise show \`/noutify language <english|español>\` and stop.
2. Accept the second argument case- and accent-insensitively only as \`es\`, \`spanish\`, \`español\`, \`espanol\`, or \`castellano\` and map it to the literal \`es\`; or case- and accent-insensitively only as \`en\`, \`english\`, \`inglés\`, or \`ingles\` and map it to the literal \`en\`.
3. Unsupported or shell-active values must show \`/noutify language <english|español>\` and stop before execution.
4. From the project root, run exactly one fixed command after mapping: Spanish \`node .claude/skills/noutify/launcher.mjs es\`; English \`node .claude/skills/noutify/launcher.mjs en\`. Do not run another Noutify subcommand.
5. Never put \`$ARGUMENTS\`, user input, an absolute project path, command substitutions, backticks, pipes, or redirects in a command.
6. Report the command result. Never read or print \`.noutify.local.json\` or its topic.
`;
}

function buildClaudeLauncher(runtime: ClaudeSkillRuntime): string {
  const cliUrl = pathToFileURL(resolve(runtime.cliPath)).href;
  return `// noutify-managed:v2
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const language = process.argv.length === 3 ? process.argv[2] : "";
if (language !== "en" && language !== "es") {
  process.stderr.write("language must be en or es\\n");
  process.exitCode = 1;
} else {
  const launcherDirectory = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(launcherDirectory, "..", "..", "..");
  const cliPath = fileURLToPath(${JSON.stringify(cliUrl)});
  const result = spawnSync(
    process.execPath,
    [cliPath, "language", language, "--project", projectRoot],
    { stdio: "inherit", shell: false, windowsHide: true },
  );
  if (result.error) {
    process.stderr.write(\`Noutify launcher failed: \${result.error.message}\\n\`);
    process.exitCode = 1;
  } else if (result.signal) {
    process.stderr.write(\`Noutify launcher terminated by signal \${result.signal}\\n\`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
`;
}

async function readOwnedFile(
  projectRoot: string,
  path: string,
): Promise<string | null> {
  await assertSafeProjectPath(projectRoot, path);
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
    contents === buildClaudeSkill(projectRoot, runtime) ||
    contents === buildLegacyClaudeSkillV1(projectRoot, runtime) ||
    contents === buildLegacyClaudeSkillV0(projectRoot, runtime)
  );
}

async function writeOwnedFileAtomic(
  projectRoot: string,
  path: string,
  contents: string,
): Promise<void> {
  await assertSafeProjectPath(projectRoot, path);
  await mkdir(dirname(path), { recursive: true });
  await assertSafeProjectPath(projectRoot, path);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await assertSafeProjectPath(projectRoot, temporaryPath);
    await writeFile(temporaryPath, contents, "utf8");
    await assertSafeProjectPath(projectRoot, temporaryPath);
    await assertSafeProjectPath(projectRoot, path);
    await rename(temporaryPath, path);
  } finally {
    await assertSafeProjectPath(projectRoot, temporaryPath);
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error;
    });
  }
}

export async function preflightClaudeSkill(
  projectRoot: string,
  runtime: ClaudeSkillRuntime,
): Promise<void> {
  validateRuntime(runtime);
  const [skill, launcher] = await Promise.all([
    readOwnedFile(projectRoot, ownedPath(projectRoot, SKILL_RELATIVE_PATH)),
    readOwnedFile(projectRoot, ownedPath(projectRoot, LAUNCHER_RELATIVE_PATH)),
  ]);
  if (skill !== null && !isRecognizedSkill(skill, projectRoot, runtime)) {
    throw new Error("Noutify Claude skill path is already occupied");
  }
  if (launcher !== null && launcher !== buildClaudeLauncher(runtime)) {
    throw new Error("Noutify Claude launcher path is already occupied");
  }
}

export async function hasClaudeSkill(
  projectRoot: string,
  runtime: ClaudeSkillRuntime,
): Promise<boolean> {
  validateRuntime(runtime);
  const [skill, launcher] = await Promise.all([
    readOwnedFile(projectRoot, ownedPath(projectRoot, SKILL_RELATIVE_PATH)),
    readOwnedFile(projectRoot, ownedPath(projectRoot, LAUNCHER_RELATIVE_PATH)),
  ]);
  return (
    skill === buildClaudeSkill(projectRoot, runtime) &&
    launcher === buildClaudeLauncher(runtime)
  );
}

export async function installClaudeSkill(
  projectRoot: string,
  runtime: ClaudeSkillRuntime,
): Promise<ClaudeSkillResult> {
  await preflightClaudeSkill(projectRoot, runtime);
  const skillFile = ownedPath(projectRoot, SKILL_RELATIVE_PATH);
  const launcherFile = ownedPath(projectRoot, LAUNCHER_RELATIVE_PATH);
  const currentSkill = buildClaudeSkill(projectRoot, runtime);
  const currentLauncher = buildClaudeLauncher(runtime);
  const [skill, launcher] = await Promise.all([
    readOwnedFile(projectRoot, skillFile),
    readOwnedFile(projectRoot, launcherFile),
  ]);
  if (skill === currentSkill && launcher === currentLauncher) {
    return { changed: false };
  }
  if (skill !== currentSkill) {
    await writeOwnedFileAtomic(projectRoot, skillFile, currentSkill);
  }
  if (launcher !== currentLauncher) {
    await writeOwnedFileAtomic(projectRoot, launcherFile, currentLauncher);
  }
  return { changed: true };
}

export async function uninstallClaudeSkill(
  projectRoot: string,
  runtime: ClaudeSkillRuntime,
): Promise<ClaudeSkillResult> {
  validateRuntime(runtime);
  const skillFile = ownedPath(projectRoot, SKILL_RELATIVE_PATH);
  const launcherFile = ownedPath(projectRoot, LAUNCHER_RELATIVE_PATH);
  const [skill, launcher] = await Promise.all([
    readOwnedFile(projectRoot, skillFile),
    readOwnedFile(projectRoot, launcherFile),
  ]);
  let changed = false;
  if (skill !== null && isRecognizedSkill(skill, projectRoot, runtime)) {
    await assertSafeProjectPath(projectRoot, skillFile);
    await unlink(skillFile);
    changed = true;
  }
  if (launcher === buildClaudeLauncher(runtime)) {
    await assertSafeProjectPath(projectRoot, launcherFile);
    await unlink(launcherFile);
    changed = true;
  }
  if (changed) {
    await removeEmptyClaudeSkillDirectory(projectRoot);
  }
  return { changed };
}

export async function removeEmptyClaudeSkillDirectory(
  projectRoot: string,
): Promise<void> {
  const directory = dirname(ownedPath(projectRoot, SKILL_RELATIVE_PATH));
  await assertSafeProjectPath(projectRoot, directory);
  await rmdir(directory).catch(
    (error: unknown) => {
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
    },
  );
}
