import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import matter from "gray-matter";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildClaudeSkill,
  hasClaudeSkill,
  installClaudeSkill,
  preflightClaudeSkill,
  uninstallClaudeSkill,
} from "../../src/installer/claude-skill.js";
import {
  restoreFileSnapshots,
  snapshotFiles,
} from "../../src/installer/file-snapshot.js";

const temporaryRoots: string[] = [];
const runtime = {
  nodePath: "C:/Program Files/nodejs/node.exe",
  cliPath: "C:/tools/noutify/dist/cli.js",
};

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noutify-skill-"));
  temporaryRoots.push(root);
  return root;
}

function skillDirectory(root: string): string {
  return join(root, ".claude", "skills", "noutify");
}

function skillPath(root: string): string {
  return join(skillDirectory(root), "SKILL.md");
}

function launcherPath(root: string): string {
  return join(skillDirectory(root), "launcher.mjs");
}

function historicalV0Skill(
  root: string,
  selectedRuntime: typeof runtime,
): string {
  const command = [
    `"${selectedRuntime.nodePath}"`,
    `"${selectedRuntime.cliPath}"`,
    "language",
    '"<language>"',
    "--project",
    `"${resolve(root)}"`,
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

function historicalV1Skill(
  root: string,
  selectedRuntime: typeof runtime,
): string {
  const command = (language: "en" | "es") => [
    `"${selectedRuntime.nodePath}"`,
    `"${selectedRuntime.cliPath}"`,
    "language",
    `"${language}"`,
    "--project",
    `"${resolve(root)}"`,
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

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("owned Claude skill lifecycle", () => {
  it("restores files byte-for-byte and removes files absent from the snapshot", async () => {
    const root = await temporaryProject();
    const existingPath = join(root, "existing.bin");
    const createdPath = join(root, "created.bin");
    const initial = new Uint8Array([0, 255, 10, 13, 65]);
    await writeFile(existingPath, initial);
    const snapshots = await snapshotFiles([existingPath, createdPath]);
    await writeFile(existingPath, new Uint8Array([1, 2, 3]));
    await writeFile(createdPath, new Uint8Array([4, 5, 6]));

    await restoreFileSnapshots(snapshots);

    expect(new Uint8Array(await readFile(existingPath))).toEqual(initial);
    await expect(readFile(createdPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates a real frontmatter-first manual v2 skill and owned launcher", async () => {
    const root = await temporaryProject();

    await expect(preflightClaudeSkill(root, runtime)).resolves.toBeUndefined();
    await expect(installClaudeSkill(root, runtime)).resolves.toEqual({ changed: true });

    const skill = await readFile(skillPath(root), "utf8");
    const parsed = matter(skill);
    expect(skill).toBe(buildClaudeSkill(root, runtime));
    expect(skill.startsWith("---\n")).toBe(true);
    expect(parsed.data).toEqual({
      name: "noutify",
      description: "Configure Noutify for this project.",
      "argument-hint": "language <english|español>",
      "disable-model-invocation": true,
    });
    expect(parsed.content.trimStart().startsWith("<!-- noutify-managed:v2 -->")).toBe(true);
    expect(parsed.content).toContain("`node .claude/skills/noutify/launcher.mjs es`");
    expect(parsed.content).toContain("`node .claude/skills/noutify/launcher.mjs en`");
    expect(parsed.content).toContain("$ARGUMENTS");
    expect(parsed.content).toContain(
      "case- and accent-insensitively only as `es`, `spanish`, `español`, `espanol`, or `castellano`",
    );
    expect(parsed.content).toContain(
      "case- and accent-insensitively only as `en`, `english`, `inglés`, or `ingles`",
    );
    expect(skill).not.toContain(root);
    expect(skill).not.toContain(runtime.nodePath);
    expect(skill).not.toContain(runtime.cliPath);
    expect(skill).not.toContain("$()");
    expect(skill.endsWith("\n")).toBe(true);
    expect(await readFile(launcherPath(root), "utf8")).toContain(
      "noutify-managed:v2",
    );
    await expect(hasClaudeSkill(root, runtime)).resolves.toBe(true);
  });

  it("runs canonical language changes through a literal launcher argument vector", async () => {
    const temporaryRoot = await temporaryProject();
    const root = join(temporaryRoot, "Project $() & ` notes");
    const runtimeDirectory = join(temporaryRoot, "Runtime $() & ` files");
    const cliPath = join(runtimeDirectory, "language runner.mjs");
    const receiptPath = join(runtimeDirectory, "receipt.json");
    await Promise.all([
      mkdir(root, { recursive: true }),
      mkdir(runtimeDirectory, { recursive: true }),
    ]);
    await writeFile(
      cliPath,
      [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(receiptPath)}, JSON.stringify({ execPath: process.execPath, args: process.argv.slice(2) }));`,
        "",
      ].join("\n"),
      "utf8",
    );
    const literalRuntime = { nodePath: process.execPath, cliPath };
    await installClaudeSkill(root, literalRuntime);

    for (const language of ["es", "en"] as const) {
      const result = spawnSync(process.execPath, [launcherPath(root), language], {
        cwd: temporaryRoot,
        encoding: "utf8",
        shell: false,
        windowsHide: true,
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(await readFile(receiptPath, "utf8"))).toEqual({
        execPath: process.execPath,
        args: ["language", language, "--project", root],
      });
    }
  });

  it("rejects unsupported launcher input before invoking the CLI", async () => {
    const root = await temporaryProject();
    const cliPath = join(root, "must-not-run.mjs");
    const receiptPath = join(root, "unexpected.txt");
    await writeFile(
      cliPath,
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(receiptPath)}, "ran");\n`,
      "utf8",
    );
    await installClaudeSkill(root, { nodePath: process.execPath, cliPath });

    const result = spawnSync(process.execPath, [launcherPath(root), "$(whoami)"], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("language must be en or es");
    await expect(readFile(receiptPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("leaves the exact current skill and launcher unchanged on repeated install", async () => {
    const root = await temporaryProject();
    await installClaudeSkill(root, runtime);
    const initialSkill = await readFile(skillPath(root), "utf8");
    const initialLauncher = await readFile(launcherPath(root), "utf8");

    await expect(installClaudeSkill(root, runtime)).resolves.toEqual({ changed: false });
    await expect(readFile(skillPath(root), "utf8")).resolves.toBe(initialSkill);
    await expect(readFile(launcherPath(root), "utf8")).resolves.toBe(initialLauncher);
  });

  it.each([
    ["v0", historicalV0Skill],
    ["v1", historicalV1Skill],
  ] as const)(
    "upgrades the exact historical %s skill published for the same paths",
    async (_version, fixture) => {
      const root = await temporaryProject();
      await mkdir(skillDirectory(root), { recursive: true });
      await writeFile(skillPath(root), fixture(root, runtime), "utf8");

      await expect(preflightClaudeSkill(root, runtime)).resolves.toBeUndefined();
      await expect(installClaudeSkill(root, runtime)).resolves.toEqual({ changed: true });
      await expect(readFile(skillPath(root), "utf8")).resolves.toBe(
        buildClaudeSkill(root, runtime),
      );
      await expect(readFile(launcherPath(root), "utf8")).resolves.toContain(
        "noutify-managed:v2",
      );
    },
  );

  it.each([
    ["v0", historicalV0Skill],
    ["v1", historicalV1Skill],
  ] as const)(
    "uninstalls the exact historical %s skill for the same paths",
    async (_version, fixture) => {
      const root = await temporaryProject();
      await mkdir(skillDirectory(root), { recursive: true });
      await writeFile(skillPath(root), fixture(root, runtime), "utf8");

      await expect(uninstallClaudeSkill(root, runtime)).resolves.toEqual({
        changed: true,
      });
      await expect(readFile(skillPath(root), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("refuses a colliding unrelated skill without overwriting it", async () => {
    const root = await temporaryProject();
    await mkdir(skillDirectory(root), { recursive: true });
    await writeFile(skillPath(root), "# Another project's skill\n", "utf8");

    await expect(preflightClaudeSkill(root, runtime)).rejects.toThrow(
      "Noutify Claude skill path is already occupied",
    );
    await expect(installClaudeSkill(root, runtime)).rejects.toThrow(
      "Noutify Claude skill path is already occupied",
    );
    await expect(readFile(skillPath(root), "utf8")).resolves.toBe(
      "# Another project's skill\n",
    );
  });

  it("refuses a colliding launcher without overwriting it", async () => {
    const root = await temporaryProject();
    await mkdir(skillDirectory(root), { recursive: true });
    await writeFile(launcherPath(root), "// unrelated launcher\n", "utf8");

    await expect(preflightClaudeSkill(root, runtime)).rejects.toThrow(
      "Noutify Claude launcher path is already occupied",
    );
    await expect(installClaudeSkill(root, runtime)).rejects.toThrow(
      "Noutify Claude launcher path is already occupied",
    );
    await expect(readFile(launcherPath(root), "utf8")).resolves.toBe(
      "// unrelated launcher\n",
    );
  });

  it("uninstalls only exact owned files and preserves other skill files", async () => {
    const root = await temporaryProject();
    const otherSkill = join(root, ".claude", "skills", "other", "SKILL.md");
    await installClaudeSkill(root, runtime);
    await mkdir(join(root, ".claude", "skills", "other"), { recursive: true });
    await writeFile(otherSkill, "# Other skill\n", "utf8");

    await expect(uninstallClaudeSkill(root, runtime)).resolves.toEqual({ changed: true });
    await expect(hasClaudeSkill(root, runtime)).resolves.toBe(false);
    await expect(readFile(skillPath(root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(launcherPath(root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(otherSkill, "utf8")).resolves.toBe("# Other skill\n");
    await expect(uninstallClaudeSkill(root, runtime)).resolves.toEqual({ changed: false });
  });

  it("preserves modified owned-looking content on uninstall", async () => {
    const root = await temporaryProject();
    await installClaudeSkill(root, runtime);
    await writeFile(skillPath(root), "<!-- noutify-managed:v2 -->\nmodified\n", "utf8");
    await writeFile(launcherPath(root), "// noutify-managed:v2\nmodified\n", "utf8");

    await expect(uninstallClaudeSkill(root, runtime)).resolves.toEqual({ changed: false });
    await expect(readFile(skillPath(root), "utf8")).resolves.toBe(
      "<!-- noutify-managed:v2 -->\nmodified\n",
    );
    await expect(readFile(launcherPath(root), "utf8")).resolves.toBe(
      "// noutify-managed:v2\nmodified\n",
    );
  });
});
