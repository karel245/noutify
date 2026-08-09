import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  packageDistribution,
  validateReleasePath,
} from "../../scripts/package.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporaryRoots = [];

beforeAll(async () => {
  const compiled = await listRelativeFiles(join(repositoryRoot, "dist"));
  expect(compiled.some((path) => path.endsWith(".js"))).toBe(true);
});

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
  const root = await mkdtemp(join(tmpdir(), "noutify-package-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await Promise.all([
    cp(join(repositoryRoot, "dist"), join(root, "dist"), { recursive: true }),
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

describe("minimal distribution packaging", () => {
  it("ships exactly the static allowlist and compiled JavaScript runtime", async () => {
    const root = await fixtureRoot();
    const artifact = await packageDistribution({ runQualityGates: false, root });
    const compiled = (await listRelativeFiles(join(root, "dist")))
      .filter((path) => path.endsWith(".js"))
      .map((path) => `dist/${path}`);

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

  it("writes a sorted exhaustive manifest with independently verified hashes", async () => {
    const root = await fixtureRoot();
    const artifact = await packageDistribution({ runQualityGates: false, root });
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

    expect(validateReleasePath(root, join(root, "release", "Noutify"))).toBe(
      join(root, "release", "Noutify"),
    );
    expect(() => validateReleasePath(root, join(root, "release"))).toThrow(
      "unsafe release output path",
    );
    expect(() => validateReleasePath(root, join(root, "release", "Elsewhere"))).toThrow(
      "unsafe release output path",
    );
  });
});
