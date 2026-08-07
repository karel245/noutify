import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  readProjectConfig,
  writeProjectConfig,
} from "../../src/config/project-config.js";
import type { Notification } from "../../src/core/types.js";
import {
  hasClaudeStopHook,
  uninstallClaudeStopHook,
} from "../../src/installer/claude-settings.js";
import { hasClaudeSkill } from "../../src/installer/claude-skill.js";
import {
  buildClaudeHookCommand,
  confirmProject,
  doctorProject,
  setProjectLanguage,
  setupProject,
  testProject,
  uninstallProject,
} from "../../src/installer/setup.js";

const temporaryRoots: string[] = [];

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noutify-setup-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("Phase 0 setup lifecycle", () => {
  it("installs, tests, confirms, diagnoses and uninstalls idempotently", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/Program Files/nodejs/node.exe",
      cliPath: "C:/tools/noutify/dist/cli.js",
    };
    const topic = "private_topic_1234567890";
    const command = buildClaudeHookCommand(root, runtime);

    const first = await setupProject({
      projectRoot: root,
      projectName: "Demo",
      server: "https://ntfy.example",
      topic,
      ...runtime,
    });
    const second = await setupProject({
      projectRoot: root,
      projectName: "Ignored on rerun",
      ...runtime,
    });

    expect(first).toMatchObject({ created: true, hookChanged: true, topic });
    expect(second).toMatchObject({
      created: false,
      hookChanged: false,
      topic,
    });
    await expect(hasClaudeStopHook(root, command)).resolves.toBe(true);
    await expect(hasClaudeSkill(root, runtime)).resolves.toBe(true);

    const settingsText = await readFile(
      join(root, ".claude", "settings.local.json"),
      "utf8",
    );
    expect(settingsText.match(/hook claude-stop/g)).toHaveLength(1);

    const sent: Notification[] = [];
    const configured = await readProjectConfig(root);
    configured.private.language = "es";
    await writeProjectConfig(root, configured);
    const testResult = await testProject(root, async (notification) => {
      sent.push(notification);
      return { ok: true, attempts: 1 } as const;
    });
    expect(testResult).toEqual({ ok: true, attempts: 1 });
    expect(sent).toEqual([
      {
        title: "Noutify conectado",
        message: "Demo: Notificación de prueba enviada por Noutify.",
        tags: ["white_check_mark"],
        priority: "default",
      },
    ]);
    expect((await readProjectConfig(root)).private.setupCompleted).toBe(false);

    await confirmProject(root);
    expect((await readProjectConfig(root)).private.setupCompleted).toBe(true);

    const diagnosis = await doctorProject(root, runtime);
    expect(diagnosis.ok).toBe(true);
    expect(diagnosis.checks).toHaveLength(5);
    expect(diagnosis.checks.every((check) => check.ok)).toBe(true);
    expect(JSON.stringify(diagnosis)).not.toContain(topic);

    const uninstall = await uninstallProject(root, runtime);
    expect(uninstall).toEqual({ changed: true, configPreserved: true });
    await expect(hasClaudeStopHook(root, command)).resolves.toBe(false);
    await expect(hasClaudeSkill(root, runtime)).resolves.toBe(false);
    await expect(readProjectConfig(root)).resolves.toBeDefined();
  });

  it("repairs the private ignore rule on an existing installation", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      ...runtime,
    });
    await writeFile(join(root, ".gitignore"), "dist/\n", "utf8");

    await setupProject({ projectRoot: root, ...runtime });

    await expect(readFile(join(root, ".gitignore"), "utf8")).resolves.toContain(
      ".noutify.local.json",
    );
  });

  it("fails doctor when duplicate Noutify hooks are present", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      ...runtime,
    });
    await confirmProject(root);
    const settingsPath = join(root, ".claude", "settings.local.json");
    const value = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks: { Stop: unknown[] };
    };
    value.hooks.Stop.push(structuredClone(value.hooks.Stop[0]));
    await writeFile(settingsPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");

    const result = await doctorProject(root, runtime);

    expect(result.ok).toBe(false);
    expect(
      result.checks.find((check) => check.name === "claude-stop-hook"),
    ).toMatchObject({ ok: false, message: "expected one Noutify Stop hook; found 2" });
  });

  it("fails doctor when the Noutify skill is modified", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      ...runtime,
    });
    await confirmProject(root);
    await writeFile(
      join(root, ".claude", "skills", "noutify", "SKILL.md"),
      "<!-- noutify-managed:v1 -->\nmodified\n",
      "utf8",
    );

    const result = await doctorProject(root, runtime);

    expect(result.ok).toBe(false);
    expect(
      result.checks.find((check) => check.name === "claude-skill"),
    ).toMatchObject({ ok: false });
  });

  it("reports changed when uninstall removes only the Noutify skill", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      ...runtime,
    });
    await uninstallClaudeStopHook(root, buildClaudeHookCommand(root, runtime));

    await expect(uninstallProject(root, runtime)).resolves.toEqual({
      changed: true,
      configPreserved: true,
    });
    await expect(hasClaudeSkill(root, runtime)).resolves.toBe(false);
  });

  it("sets an existing project's normalized notification language", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      ...runtime,
    });

    await expect(setProjectLanguage(root, "espa\u00f1ol")).resolves.toBe("es");
    expect((await readProjectConfig(root)).private.language).toBe("es");
  });

  it("restores every setup target when the final skill write fails", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    const ignorePath = join(root, ".gitignore");
    const settingsPath = join(root, ".claude", "settings.local.json");
    const backupPath = `${settingsPath}.noutify-backup`;
    const publicPath = join(root, "noutify.config.json");
    const privatePath = join(root, ".noutify.local.json");
    const skillPath = join(root, ".claude", "skills", "noutify", "SKILL.md");
    const noutifySkillDirectory = join(root, ".claude", "skills", "noutify");
    const otherSkill = join(root, ".claude", "skills", "other", "SKILL.md");
    const originalIgnore = "dist/\n";
    const originalSettings = '{\n  "permissions": { "allow": ["Read"] }\n}\n';
    await writeFile(ignorePath, originalIgnore, "utf8");
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(settingsPath, originalSettings, "utf8");
    await mkdir(join(root, ".claude", "skills", "other"), { recursive: true });
    await writeFile(otherSkill, "# Other skill\n", "utf8");

    await expect(
      setupProject(
        {
          projectRoot: root,
          topic: "private_topic_1234567890",
          ...runtime,
        },
        {
          installSkill: async () => {
            await mkdir(noutifySkillDirectory, { recursive: true });
            await writeFile(skillPath, "partial skill\n", "utf8");
            throw new Error("skill write failed");
          },
        },
      ),
    ).rejects.toThrow("skill write failed");

    await expect(readFile(ignorePath, "utf8")).resolves.toBe(originalIgnore);
    await expect(readFile(settingsPath, "utf8")).resolves.toBe(originalSettings);
    await expect(access(publicPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(privatePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(skillPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(noutifySkillDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(otherSkill, "utf8")).resolves.toBe("# Other skill\n");
    await expect(access(backupPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves a pre-existing empty Noutify skill directory during rollback", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    const skillDirectory = join(root, ".claude", "skills", "noutify");
    const skillPath = join(skillDirectory, "SKILL.md");
    await mkdir(skillDirectory, { recursive: true });

    await expect(
      setupProject(
        {
          projectRoot: root,
          topic: "private_topic_1234567890",
          ...runtime,
        },
        {
          installSkill: async () => {
            await writeFile(skillPath, "partial skill\n", "utf8");
            throw new Error("skill write failed");
          },
        },
      ),
    ).rejects.toThrow("skill write failed");

    await expect(access(skillDirectory)).resolves.toBeUndefined();
    await expect(access(skillPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
