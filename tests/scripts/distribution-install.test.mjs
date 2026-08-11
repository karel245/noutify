import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { packageDistribution } from "../../scripts/package.mjs";
import {
  parseDistributionArguments,
  runDistributionInstall,
} from "../../scripts/distribution-install.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function listRelativeFiles(root, ignoredTopLevel = new Set()) {
  const files = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (folder === root && ignoredTopLevel.has(entry.name)) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  await visit(root);
  return files.sort();
}

async function packagedCopy() {
  await mkdir(join(repositoryRoot, "work"), { recursive: true });
  const fixture = await mkdtemp(join(repositoryRoot, "work", "distribution-fixture-"));
  const target = await mkdtemp(join(tmpdir(), "noutify-distribution-target-"));
  temporaryRoots.push(fixture, target);
  await mkdir(join(fixture, "docs"), { recursive: true });
  await mkdir(join(fixture, "scripts"), { recursive: true });
  await Promise.all([
    cp(join(repositoryRoot, "src"), join(fixture, "src"), { recursive: true }),
    cp(join(repositoryRoot, "tsconfig.json"), join(fixture, "tsconfig.json")),
    cp(join(repositoryRoot, "tsconfig.build.json"), join(fixture, "tsconfig.build.json")),
    cp(join(repositoryRoot, "LICENSE"), join(fixture, "LICENSE")),
    cp(join(repositoryRoot, "SETUP.md"), join(fixture, "SETUP.md")),
    cp(
      join(repositoryRoot, "docs", "setup-troubleshooting.md"),
      join(fixture, "docs", "setup-troubleshooting.md"),
    ),
    cp(
      join(repositoryRoot, "scripts", "distribution-install.mjs"),
      join(fixture, "scripts", "distribution-install.mjs"),
    ),
  ]);
  const artifact = await packageDistribution({ runQualityGates: false, root: fixture });
  const copiedArtifact = join(target, "Noutify");
  await cp(artifact, copiedArtifact, { recursive: true });
  return { artifact: copiedArtifact, target };
}

describe("lightweight distribution installer", () => {
  it("blocks fetch, HTTP(S), TCP, and DNS in the guarded child runtime", () => {
    const guardPath = join(repositoryRoot, "scripts", "offline-network-guard.mjs");
    const probe = `
      import http from "node:http";
      import https from "node:https";
      import net from "node:net";
      import dns from "node:dns";
      const attempts = [
        () => fetch("http://127.0.0.1:9"),
        () => http.get("http://127.0.0.1:9"),
        () => https.get("https://127.0.0.1:9"),
        () => net.connect(9, "127.0.0.1"),
        () => dns.lookup("localhost", () => {}),
      ];
      const codes = [];
      for (const attempt of attempts) {
        try { await attempt(); }
        catch (error) { codes.push(error.code); }
      }
      if (codes.length !== 5 || codes.some((code) => code !== "NOUTIFY_OFFLINE_NETWORK_DISABLED")) {
        process.exitCode = 7;
      }
    `;

    const result = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(guardPath).href, "--input-type=module", "--eval", probe],
      { encoding: "utf8", windowsHide: true, shell: false },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("preserves repeated explicit agents and memory links", () => {
    expect(
      parseDistributionArguments([
        "--language",
        "es",
        "--agent",
        "codex",
        "--agent",
        "generic:cursor",
        "--memory-link",
        "generic:cursor=AGENTS.md",
      ]),
    ).toEqual({
      language: "es",
      agents: ["codex", "generic:cursor"],
      memoryLinks: ["generic:cursor=AGENTS.md"],
    });
  });

  it("requires an explicit agent before executing setup", async () => {
    const { artifact, target } = await packagedCopy();
    let spawned = false;
    const stderr = [];

    const exitCode = await runDistributionInstall(["--language", "en", "--project", target], {
      artifactRoot: artifact,
      platform: "win32",
      nodeVersion: "24.0.0",
      nodePath: process.execPath,
      spawn: () => {
        spawned = true;
        return { status: 0, stdout: "", stderr: "" };
      },
      writeStdout: () => undefined,
      writeStderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(spawned).toBe(false);
    expect(stderr.join("")).toContain("at least one --agent is required");
  });

  it.each([
    { platform: "linux", nodeVersion: "24.0.0", message: "requires Windows" },
    { platform: "win32", nodeVersion: "23.9.0", message: "Node.js 24 or newer" },
  ])("rejects unsupported runtime $platform/$nodeVersion before setup", async ({
    platform,
    nodeVersion,
    message,
  }) => {
    const { artifact } = await packagedCopy();
    let spawned = false;
    const stderr = [];

    const exitCode = await runDistributionInstall(
      ["--language", "en", "--agent", "codex"],
      {
        artifactRoot: artifact,
        platform,
        nodeVersion,
        nodePath: process.execPath,
        spawn: () => {
          spawned = true;
          return { status: 0, stdout: "", stderr: "" };
        },
        writeStdout: () => undefined,
        writeStderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(1);
    expect(spawned).toBe(false);
    expect(stderr.join("")).toContain(message);
  });

  const windowsIt = process.platform === "win32" ? it : it.skip;
  windowsIt("installs every native adapter from a copied artifact with dependencies and networking unavailable", async () => {
    const { artifact, target } = await packagedCopy();
    const installPath = join(artifact, "install.mjs");
    const result = spawnSync(
      process.execPath,
      [
        installPath,
        "--language",
        "es",
        "--agent",
        "windsurf",
        "--agent",
        "copilot-cli",
        "--agent",
        "gemini-cli",
        "--agent",
        "codex",
        "--agent",
        "claude-code",
      ],
      {
        cwd: target,
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          HTTP_PROXY: "http://127.0.0.1:1",
          HTTPS_PROXY: "http://127.0.0.1:1",
          ALL_PROXY: "http://127.0.0.1:1",
          NO_PROXY: "",
          NODE_PATH: join(target, "missing-node-modules"),
        },
      },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await listRelativeFiles(target, new Set(["Noutify"]))).toEqual([
      ".claude/settings.local.json",
      ".claude/skills/noutify/SKILL.md",
      ".claude/skills/noutify/launcher.mjs",
      ".codex/hooks.json",
      ".gemini/settings.json",
      ".github/copilot/settings.local.json",
      ".gitignore",
      ".noutify.local.json",
      ".windsurf/hooks.json",
      "noutify.config.json",
    ]);
    const publicConfig = JSON.parse(await readFile(join(target, "noutify.config.json"), "utf8"));
    expect(publicConfig.integrations).toEqual([
      { agent: "claude-code", mode: "native", path: ".claude/settings.local.json" },
      { agent: "codex", mode: "native", path: ".codex/hooks.json" },
      {
        agent: "copilot-cli",
        mode: "native",
        path: ".github/copilot/settings.local.json",
      },
      { agent: "gemini-cli", mode: "native", path: ".gemini/settings.json" },
      { agent: "windsurf", mode: "native", path: ".windsurf/hooks.json" },
    ]);
  });

  it("rejects a missing compiled adapter dependency before mutating the target", async () => {
    const { artifact } = await packagedCopy();
    const target = join(dirname(artifact), "missing-dependency-target");
    await rm(join(artifact, "dist", "installer", "adapters", "windsurf.js"));
    let spawned = false;

    const exitCode = await runDistributionInstall(
      [
        "--language",
        "en",
        "--agent",
        "claude-code",
        "--agent",
        "codex",
        "--agent",
        "copilot-cli",
        "--agent",
        "gemini-cli",
        "--agent",
        "windsurf",
        "--project",
        target,
      ],
      {
        artifactRoot: artifact,
        platform: "win32",
        nodeVersion: "24.0.0",
        nodePath: process.execPath,
        spawn: () => {
          spawned = true;
          return { status: 0, stdout: "", stderr: "" };
        },
        writeStdout: () => undefined,
        writeStderr: () => undefined,
      },
    );

    expect(exitCode).toBe(1);
    expect(spawned).toBe(false);
    await expect(readdir(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("detects a changed compiled byte before mutating the target", async () => {
    const { artifact } = await packagedCopy();
    const target = join(dirname(artifact), "untouched-target");
    const cliPath = join(artifact, "dist", "cli.js");
    await writeFile(cliPath, `${await readFile(cliPath, "utf8")} `, "utf8");
    let spawned = false;

    const exitCode = await runDistributionInstall(
      ["--language", "en", "--agent", "codex", "--project", target],
      {
        artifactRoot: artifact,
        platform: "win32",
        nodeVersion: "24.0.0",
        nodePath: process.execPath,
        spawn: () => {
          spawned = true;
          return { status: 0, stdout: "", stderr: "" };
        },
        writeStdout: () => undefined,
        writeStderr: () => undefined,
      },
    );

    expect(exitCode).toBe(1);
    expect(spawned).toBe(false);
    await expect(readdir(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an unmanifested artifact file before mutating the target", async () => {
    const { artifact } = await packagedCopy();
    const target = join(dirname(artifact), "membership-target");
    await writeFile(join(artifact, "unexpected.js"), "export {};\n", "utf8");
    let spawned = false;

    const exitCode = await runDistributionInstall(
      ["--language", "en", "--agent", "codex", "--project", target],
      {
        artifactRoot: artifact,
        platform: "win32",
        nodeVersion: "24.0.0",
        nodePath: process.execPath,
        spawn: () => {
          spawned = true;
          return { status: 0, stdout: "", stderr: "" };
        },
        writeStdout: () => undefined,
        writeStderr: () => undefined,
      },
    );

    expect(exitCode).toBe(1);
    expect(spawned).toBe(false);
    await expect(readdir(target)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
