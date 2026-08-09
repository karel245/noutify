#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateDistributionArtifact } from "./distribution-install.mjs";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staticFiles = [
  ["LICENSE", "LICENSE"],
  ["SETUP.md", "SETUP.md"],
  ["docs/setup-troubleshooting.md", "docs/setup-troubleshooting.md"],
  ["scripts/distribution-install.mjs", "install.mjs"],
];

export function validateReleasePath(repositoryRoot, releaseRoot) {
  const expected = resolve(repositoryRoot, "release", "Noutify");
  if (resolve(releaseRoot) !== expected || dirname(expected) === expected) {
    throw new Error("unsafe release output path");
  }
  return expected;
}

export function manifestEntry(relativePath, bytes) {
  return {
    path: relativePath.replaceAll("\\", "/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function listCompiledJavaScript(root) {
  const distRoot = join(root, "dist");
  const files = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error("compiled output may not contain symbolic links");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
    }
  }
  await visit(distRoot);
  if (!files.some((path) => relative(distRoot, path).replaceAll("\\", "/") === "cli.js")) {
    throw new Error("compiled CLI is missing");
  }
  return files.sort((left, right) => {
    const leftPath = relative(distRoot, left).replaceAll("\\", "/");
    const rightPath = relative(distRoot, right).replaceAll("\\", "/");
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });
}

function runNodeGate(root, label, entry, argumentsList) {
  const result = spawnSync(process.execPath, [entry, ...argumentsList], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit ${result.status ?? 1}`);
  }
}

function runQualityGates(root) {
  const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
  const vitest = join(root, "node_modules", "vitest", "vitest.mjs");
  runNodeGate(root, "build", tsc, ["-p", "tsconfig.build.json"]);
  runNodeGate(root, "tests", vitest, ["run"]);
  runNodeGate(root, "typecheck", tsc, ["-p", "tsconfig.json", "--noEmit"]);
}

async function createArtifact(root, releaseRoot) {
  const output = validateReleasePath(root, releaseRoot);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  for (const [source, destination] of staticFiles) {
    const target = join(output, ...destination.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, ...source.split("/")), target);
  }
  const distRoot = join(root, "dist");
  for (const source of await listCompiledJavaScript(root)) {
    const destination = join(output, "dist", relative(distRoot, source));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  const artifactFiles = [];
  async function collect(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile()) artifactFiles.push(path);
      else throw new Error("release contains an unsupported filesystem entry");
    }
  }
  await collect(output);
  const entries = await Promise.all(
    artifactFiles.map(async (path) =>
      manifestEntry(relative(output, path), await readFile(path)),
    ),
  );
  entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  await writeFile(
    join(output, "manifest.json"),
    `${JSON.stringify({ formatVersion: 1, version: "0.0.1", node: ">=24", files: entries }, null, 2)}\n`,
    "utf8",
  );
  await validateDistributionArtifact(output);
  return output;
}

async function smokeInstallOffline(artifact) {
  const smokeRoot = await mkdtemp(join(tmpdir(), "noutify-package-smoke-"));
  try {
    const target = join(smokeRoot, "Target");
    const copiedArtifact = join(target, "Noutify");
    await mkdir(target, { recursive: true });
    await cp(artifact, copiedArtifact, { recursive: true });
    const result = spawnSync(
      process.execPath,
      [join(copiedArtifact, "install.mjs"), "--language", "en", "--agent", "codex"],
      {
        cwd: target,
        encoding: "utf8",
        windowsHide: true,
        shell: false,
        env: {
          ...process.env,
          HTTP_PROXY: "http://127.0.0.1:1",
          HTTPS_PROXY: "http://127.0.0.1:1",
          ALL_PROXY: "http://127.0.0.1:1",
          NO_PROXY: "",
          NODE_PATH: join(smokeRoot, "missing-node-modules"),
        },
      },
    );
    if (result.status !== 0) {
      throw new Error(`offline installation smoke failed: ${String(result.stderr ?? "").trim()}`);
    }
  } finally {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

export async function packageDistribution(options = {}) {
  const root = resolve(options.root ?? moduleRoot);
  const runGates = options.runQualityGates !== false;
  if (runGates) runQualityGates(root);
  const artifact = await createArtifact(root, join(root, "release", "Noutify"));
  if (runGates) await smokeInstallOffline(artifact);
  return artifact;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  packageDistribution()
    .then(() => process.stdout.write("PASS package\n"))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "packaging failed"}\n`);
      process.exitCode = 1;
    });
}
