import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

function skillPath(root: string): string {
  return join(root, ".claude", "skills", "noutify", "SKILL.md");
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

  it("creates the owned skill with the supported language command", async () => {
    const root = await temporaryProject();

    await expect(preflightClaudeSkill(root, runtime)).resolves.toBeUndefined();
    await expect(installClaudeSkill(root, runtime)).resolves.toEqual({ changed: true });

    const skill = await readFile(skillPath(root), "utf8");
    expect(skill).toBe(buildClaudeSkill(root, runtime));
    expect(skill.startsWith([
      "<!-- noutify-managed:v1 -->",
      "---",
      "name: noutify",
      "description: Configure Noutify for this project.",
      "argument-hint: language <english|español>",
      "disable-model-invocation: true",
      "---",
      "",
    ].join("\n"))).toBe(true);
    expect(skill).toContain("$ARGUMENTS");
    expect(skill).toContain("only for `language <language>`");
    expect(skill).toContain(
      "case- and accent-insensitively only as `es`, `spanish`, `español`, `espanol`, or `castellano`",
    );
    expect(skill).toContain(
      "case- and accent-insensitively only as `en`, `english`, `inglés`, or `ingles`",
    );
    expect(skill).toContain(
      `"C:/Program Files/nodejs/node.exe" "C:/tools/noutify/dist/cli.js" language "es" --project "${root}"`,
    );
    expect(skill).toContain(
      `"C:/Program Files/nodejs/node.exe" "C:/tools/noutify/dist/cli.js" language "en" --project "${root}"`,
    );
    expect(skill).toContain(
      "Never interpolate `$ARGUMENTS` or the raw second token into any shell command.",
    );
    expect(skill).toContain(
      "Unsupported or shell-active values must show `/noutify language <english|español>` and stop before execution.",
    );
    expect(skill).not.toContain('language "<language>"');
    expect(skill.endsWith("\n")).toBe(true);
    await expect(hasClaudeSkill(root, runtime)).resolves.toBe(true);
  });

  it("leaves the exact current skill unchanged on repeated install", async () => {
    const root = await temporaryProject();
    await installClaudeSkill(root, runtime);
    const initial = await readFile(skillPath(root), "utf8");

    await expect(installClaudeSkill(root, runtime)).resolves.toEqual({ changed: false });
    await expect(readFile(skillPath(root), "utf8")).resolves.toBe(initial);
  });

  it("upgrades the exact v0 skill for the same runtime and project", async () => {
    const root = await temporaryProject();
    await mkdir(join(root, ".claude", "skills", "noutify"), { recursive: true });
    await writeFile(
      skillPath(root),
      buildClaudeSkill(root, runtime).replace(
        "<!-- noutify-managed:v1 -->",
        "<!-- noutify-managed:v0 -->",
      ),
      "utf8",
    );

    await expect(preflightClaudeSkill(root, runtime)).resolves.toBeUndefined();
    await expect(installClaudeSkill(root, runtime)).resolves.toEqual({ changed: true });
    await expect(readFile(skillPath(root), "utf8")).resolves.toBe(
      buildClaudeSkill(root, runtime),
    );
  });

  it("uninstalls an exact v0 skill for the same runtime and project", async () => {
    const root = await temporaryProject();
    await mkdir(join(root, ".claude", "skills", "noutify"), { recursive: true });
    await writeFile(
      skillPath(root),
      buildClaudeSkill(root, runtime).replace(
        "<!-- noutify-managed:v1 -->",
        "<!-- noutify-managed:v0 -->",
      ),
      "utf8",
    );

    await expect(uninstallClaudeSkill(root, runtime)).resolves.toEqual({ changed: true });
    await expect(readFile(skillPath(root), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses a colliding unrelated skill without overwriting it", async () => {
    const root = await temporaryProject();
    await mkdir(join(root, ".claude", "skills", "noutify"), { recursive: true });
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

  it("uninstalls only exact owned content and preserves other skill directories", async () => {
    const root = await temporaryProject();
    const otherSkill = join(root, ".claude", "skills", "other", "SKILL.md");
    await installClaudeSkill(root, runtime);
    await mkdir(join(root, ".claude", "skills", "other"), { recursive: true });
    await writeFile(otherSkill, "# Other skill\n", "utf8");

    await expect(uninstallClaudeSkill(root, runtime)).resolves.toEqual({ changed: true });
    await expect(hasClaudeSkill(root, runtime)).resolves.toBe(false);
    await expect(readFile(otherSkill, "utf8")).resolves.toBe("# Other skill\n");
    await expect(uninstallClaudeSkill(root, runtime)).resolves.toEqual({ changed: false });
  });

  it("preserves modified owned content on uninstall", async () => {
    const root = await temporaryProject();
    await installClaudeSkill(root, runtime);
    await writeFile(skillPath(root), "<!-- noutify-managed:v1 -->\nmodified\n", "utf8");

    await expect(uninstallClaudeSkill(root, runtime)).resolves.toEqual({ changed: false });
    await expect(readFile(skillPath(root), "utf8")).resolves.toBe(
      "<!-- noutify-managed:v1 -->\nmodified\n",
    );
  });
});
