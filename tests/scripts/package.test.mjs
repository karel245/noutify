import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import * as packaging from "../../scripts/package.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function listRelativeFiles(root) {
  const files = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  await visit(root);
  return files.sort();
}

async function fixtureRoot() {
  await mkdir(join(repositoryRoot, "work"), { recursive: true });
  const root = await mkdtemp(join(repositoryRoot, "work", "package-fixture-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await Promise.all([
    cp(join(repositoryRoot, "src"), join(root, "src"), { recursive: true }),
    cp(join(repositoryRoot, "tsconfig.json"), join(root, "tsconfig.json")),
    cp(join(repositoryRoot, "tsconfig.build.json"), join(root, "tsconfig.build.json")),
    cp(join(repositoryRoot, "LICENSE"), join(root, "LICENSE")),
    cp(join(repositoryRoot, "SETUP.md"), join(root, "SETUP.md")),
    cp(
      join(repositoryRoot, "docs", "setup-troubleshooting.md"),
      join(root, "docs", "setup-troubleshooting.md"),
    ),
    cp(
      join(repositoryRoot, "scripts", "distribution-install.mjs"),
      join(root, "scripts", "distribution-install.mjs"),
    ),
  ]);
  return root;
}

async function expectedCompiledPaths(root) {
  return (await listRelativeFiles(join(root, "src")))
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".d.ts"))
    .map((path) => `dist/${path.slice(0, -3)}.js`)
    .sort();
}

async function temporaryBuildFolders() {
  return new Set(
    (await readdir(tmpdir(), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("noutify-build-"))
      .map((entry) => entry.name),
  );
}

describe("minimal distribution packaging", () => {
  it("builds a clean checkout and ships exactly the allowlisted runtime", async () => {
    const root = await fixtureRoot();
    await expect(readdir(join(root, "dist"))).rejects.toMatchObject({ code: "ENOENT" });
    const artifact = await packaging.packageDistribution({ runQualityGates: false, root });
    const compiled = await expectedCompiledPaths(root);

    expect(await listRelativeFiles(artifact)).toEqual(
      [
        "LICENSE",
        "SETUP.md",
        ...compiled,
        "docs/setup-troubleshooting.md",
        "install.mjs",
        "manifest.json",
      ].sort(),
    );
  });

  it("never packages JavaScript left in a previous repository dist", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "cli.js"), "export {};\n", "utf8");
    await writeFile(join(root, "dist", "stale-sentinel.js"), "throw new Error('stale');\n", "utf8");

    const artifact = await packaging.packageDistribution({ runQualityGates: false, root });

    expect(await listRelativeFiles(artifact)).toEqual(
      [
        "LICENSE",
        "SETUP.md",
        ...(await expectedCompiledPaths(root)),
        "docs/setup-troubleshooting.md",
        "install.mjs",
        "manifest.json",
      ].sort(),
    );
    await expect(readFile(join(artifact, "dist", "stale-sentinel.js"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes a sorted exhaustive manifest with independently verified hashes", async () => {
    const root = await fixtureRoot();
    const artifact = await packaging.packageDistribution({ runQualityGates: false, root });
    const manifest = JSON.parse(await readFile(join(artifact, "manifest.json"), "utf8"));
    const actualFiles = await listRelativeFiles(artifact);

    expect(manifest).toMatchObject({ formatVersion: 1, version: "0.0.1", node: ">=24" });
    expect(manifest.files.map(({ path }) => path)).toEqual(
      actualFiles.filter((path) => path !== "manifest.json"),
    );
    for (const entry of manifest.files) {
      const expected = createHash("sha256")
        .update(await readFile(join(artifact, ...entry.path.split("/"))))
        .digest("hex");
      expect(entry.sha256).toBe(expected);
    }
    expect(JSON.stringify(manifest)).not.toContain("Noutify-");
  });

  it("rejects every release output except the exact repository release folder", () => {
    const root = resolve("C:\\safe\\repository");

    expect(packaging.validateReleasePath(root, join(root, "release", "Noutify"))).toBe(
      join(root, "release", "Noutify"),
    );
    expect(() => packaging.validateReleasePath(root, join(root, "release"))).toThrow(
      "unsafe release output path",
    );
    expect(() => packaging.validateReleasePath(root, join(root, "release", "Elsewhere"))).toThrow(
      "unsafe release output path",
    );
  });

  it("permits cleanup only for the exact generated build folder", () => {
    const parent = resolve("C:\\safe\\temporary");
    const generated = join(parent, "noutify-build-123456");

    expect(packaging.validateTemporaryBuildPath(parent, generated)).toBe(generated);
    expect(() => packaging.validateTemporaryBuildPath(parent, parent)).toThrow(
      "unsafe temporary build path",
    );
    expect(() => packaging.validateTemporaryBuildPath(parent, join(parent, "other"))).toThrow(
      "unsafe temporary build path",
    );
  });

  it("removes the isolated build folder when compilation fails", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "src", "broken.ts"), "export const broken = ;\n", "utf8");
    const before = await temporaryBuildFolders();

    await expect(
      packaging.packageDistribution({ runQualityGates: false, root }),
    ).rejects.toThrow("build failed");

    expect(await temporaryBuildFolders()).toEqual(before);
  });

  it("propagates network denial into Node children launched by the installer", () => {
    const guardPath = join(repositoryRoot, "scripts", "offline-network-guard.mjs");
    const childProbe = `
      import net from "node:net";
      try {
        const socket = net.connect(9, "127.0.0.1");
        socket.once("error", (error) => {
          process.exitCode = error.code === "NOUTIFY_OFFLINE_NETWORK_DISABLED" ? 0 : 7;
        });
        setTimeout(() => { process.exitCode = 8; }, 100);
      } catch (error) {
        process.exitCode = error.code === "NOUTIFY_OFFLINE_NETWORK_DISABLED" ? 0 : 7;
      }
    `;
    const outerProbe = `
      import { spawnSync } from "node:child_process";
      const result = spawnSync(process.execPath, ["--input-type=module", "--eval", ${JSON.stringify(childProbe)}]);
      process.exitCode = result.status ?? 9;
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", outerProbe],
      {
        encoding: "utf8",
        windowsHide: true,
        shell: false,
        env: packaging.offlineChildEnvironment(process.env, guardPath),
      },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
