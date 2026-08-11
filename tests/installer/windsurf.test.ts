import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildWindsurfPostResponseHookCommand,
  windsurfAdapter,
} from "../../src/installer/adapters/windsurf.js";
import { setupProject, uninstallProject } from "../../src/installer/setup.js";

const temporaryRoots: string[] = [];

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noutify-windsurf-"));
  temporaryRoots.push(root);
  return root;
}

function hooksPath(root: string): string {
  return join(root, ".windsurf", "hooks.json");
}

async function hooks(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(hooksPath(root), "utf8")) as Record<
    string,
    unknown
  >;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("Windsurf adapter", () => {
  it("builds and executes one shell-safe fixed Windows invocation", async () => {
    const base = await temporaryProject();
    const projectRoot = join(base, "Project & ! % (test)");
    const toolDirectory = join(base, "Tool & O'Brien %");
    const cliPath = join(toolDirectory, "capture.mjs");
    await mkdir(projectRoot);
    await mkdir(toolDirectory);
    await writeFile(
      cliPath,
      [
        'import { writeFileSync } from "node:fs";',
        'import { join } from "node:path";',
        "const values = process.argv.slice(2);",
        'let input = "";',
        "for await (const chunk of process.stdin) input += String(chunk);",
        "const root = values.at(-1);",
        'if (!root) throw new Error("missing project root");',
        'writeFileSync(join(root, "windsurf-hook-args.json"), JSON.stringify({ values, input }));',
        "",
      ].join("\n"),
      "utf8",
    );

    const command = buildWindsurfPostResponseHookCommand(projectRoot, {
      nodePath: process.execPath,
      cliPath,
    });

    expect(command).toMatch(
      /^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/,
    );
    if (process.platform === "win32") {
      const input = JSON.stringify({
        agent_action_name: "post_cascade_response",
        tool_info: { response: "& whoami; $(Get-ChildItem) | %PATH% !bang!" },
        workspace_root: "C:/spoofed/root",
      });
      const result = spawnSync(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", command],
        { encoding: "utf8", input, windowsHide: true, shell: false },
      );
      expect(result.status, String(result.stderr)).toBe(0);
      await expect(
        readFile(join(projectRoot, "windsurf-hook-args.json"), "utf8"),
      ).resolves.toBe(
        JSON.stringify({
          values: [
            "hook",
            "windsurf-post-response",
            "--project",
            projectRoot,
          ],
          input,
        }),
      );
    }
  });

  it("installs only the workspace post-response hook with the documented fields", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/Program Files/nodejs/node.exe",
      cliPath: "C:/Noutify Tool/dist/cli.js",
    };
    const command = buildWindsurfPostResponseHookCommand(root, runtime);

    await setupProject({ projectRoot: root, agents: ["windsurf"], ...runtime });

    await expect(hooks(root)).resolves.toEqual({
      hooks: {
        post_cascade_response: [{ command, show_output: false }],
      },
    });
    await expect(access(join(root, ".claude"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(root, ".codex"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(root, ".gemini"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(root, ".github"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(root, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves unrelated hooks and repairs duplicate exact-owned entries", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    const command = buildWindsurfPostResponseHookCommand(root, runtime);
    const owned = { command, show_output: false };
    const unrelated = { command: "python existing.py", show_output: true };
    const path = hooksPath(root);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ version: 1, hooks: { pre_read_code: [unrelated], post_cascade_response: [owned, unrelated, owned] } }, null, 2)}\n`,
      "utf8",
    );

    await expect(
      windsurfAdapter.install({ projectRoot: root, runtime }),
    ).resolves.toEqual({ changed: true });
    await expect(hooks(root)).resolves.toEqual({
      version: 1,
      hooks: {
        pre_read_code: [unrelated],
        post_cascade_response: [unrelated, owned],
      },
    });
  });

  it.each([
    ['{"hooks":[]}', "Windsurf hooks hooks must be an object"],
    [
      '{"hooks":{"post_cascade_response":{}}}',
      "Windsurf hooks hooks.post_cascade_response must be an array",
    ],
  ])("rejects a malformed hook container before any mutation", async (contents, message) => {
    const root = await temporaryProject();
    const path = hooksPath(root);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");

    await expect(
      setupProject({
        projectRoot: root,
        agents: ["windsurf"],
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/cli.js",
      }),
    ).rejects.toThrow(message);
    await expect(readFile(path, "utf8")).resolves.toBe(contents);
    await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a linked Windsurf directory without writing outside the project", async () => {
    const root = await temporaryProject();
    const outside = await temporaryProject();
    await symlink(
      outside,
      join(root, ".windsurf"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      setupProject({
        projectRoot: root,
        agents: ["windsurf"],
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/cli.js",
      }),
    ).rejects.toThrow(/symbolic link|junction|reparse|unsafe project path/i);
    await expect(access(join(outside, "hooks.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rolls the hook back when the Windsurf adapter fails after writing", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    const failingAdapter = {
      ...windsurfAdapter,
      install: async (context: Parameters<typeof windsurfAdapter.install>[0]) => {
        await windsurfAdapter.install(context);
        throw new Error("adapter failed after writing");
      },
    };

    await expect(
      setupProject(
        { projectRoot: root, agents: ["windsurf"], ...runtime },
        { adapters: [failingAdapter] },
      ),
    ).rejects.toThrow("adapter failed after writing");
    await expect(access(hooksPath(root))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("uninstalls only the exact-owned entry", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    const command = buildWindsurfPostResponseHookCommand(root, runtime);
    const owned = { command, show_output: false };
    const similar = { command, show_output: true };
    const unrelated = { command: "python existing.py", show_output: false };
    const path = hooksPath(root);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ hooks: { pre_read_code: [unrelated], post_cascade_response: [owned, similar] } }, null, 2)}\n`,
      "utf8",
    );

    await setupProject({ projectRoot: root, agents: ["windsurf"], ...runtime });
    await expect(uninstallProject(root, runtime)).resolves.toEqual({
      changed: true,
      configPreserved: true,
    });
    await expect(hooks(root)).resolves.toEqual({
      hooks: {
        pre_read_code: [unrelated],
        post_cascade_response: [similar],
      },
    });
  });
});
