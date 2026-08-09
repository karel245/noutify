#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
import { basename, dirname, join, relative, resolve } from "node:path";
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

export function validateTemporaryBuildPath(temporaryRoot, buildRoot) {
  const parent = resolve(temporaryRoot);
  const target = resolve(buildRoot);
  if (
    dirname(target) !== parent ||
    !basename(target).startsWith("noutify-build-") ||
    basename(target).length <= "noutify-build-".length
  ) {
    throw new Error("unsafe temporary build path");
  }
  return target;
}

export function manifestEntry(relativePath, bytes) {
  return {
    path: relativePath.replaceAll("\\", "/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function offlineChildEnvironment(baseEnvironment, guardPath) {
  const importOption = `--import=${pathToFileURL(resolve(guardPath)).href}`;
  const existingOptions = String(baseEnvironment.NODE_OPTIONS ?? "").trim();
  return {
    ...baseEnvironment,
    HTTP_PROXY: "http://127.0.0.1:1",
    HTTPS_PROXY: "http://127.0.0.1:1",
    ALL_PROXY: "http://127.0.0.1:1",
    NO_PROXY: "",
    NODE_OPTIONS: existingOptions ? `${existingOptions} ${importOption}` : importOption,
  };
}

async function listCompiledJavaScript(distRoot) {
  const files = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error("compiled output may not contain symbolic links");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
      else throw new Error("isolated build contains a non-JavaScript file");
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

function runNodeGate(root, label, entry, argumentsList, inheritOutput = true) {
  const result = spawnSync(process.execPath, [entry, ...argumentsList], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    stdio: inheritOutput ? "inherit" : "pipe",
    shell: false,
  });
  if (result.status !== 0) {
    const diagnostics = inheritOutput
      ? ""
      : `: ${String(result.stderr ?? result.stdout ?? "").trim()}`;
    throw new Error(`${label} failed with exit ${result.status ?? 1}${diagnostics}`);
  }
}

function runQualityGates(root) {
  const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
  const vitest = join(root, "node_modules", "vitest", "vitest.mjs");
  runNodeGate(root, "tests", vitest, ["run"]);
  runNodeGate(root, "typecheck", tsc, ["-p", "tsconfig.json", "--noEmit"]);
}

function findToolingRoot(root) {
  let candidate = resolve(root);
  while (true) {
    const compiler = join(candidate, "node_modules", "typescript", "bin", "tsc");
    if (existsSync(compiler)) return candidate;
    const next = dirname(candidate);
    if (next === candidate) break;
    candidate = next;
  }
  throw new Error("TypeScript compiler is unavailable");
}

async function compileIsolatedRuntime(root) {
  const temporaryRoot = resolve(tmpdir());
  const buildRoot = validateTemporaryBuildPath(
    temporaryRoot,
    await mkdtemp(join(temporaryRoot, "noutify-build-")),
  );
  const output = join(buildRoot, "dist");
  try {
    const toolingRoot = findToolingRoot(root);
    const compiler = join(toolingRoot, "node_modules", "typescript", "bin", "tsc");
    runNodeGate(
      root,
      "build",
      compiler,
      [
        "-p",
        join(root, "tsconfig.build.json"),
        "--outDir",
        output,
        "--declaration",
        "false",
        "--sourceMap",
        "false",
      ],
      false,
    );
    return { buildRoot, temporaryRoot, output };
  } catch (error) {
    await rm(
      validateTemporaryBuildPath(temporaryRoot, buildRoot),
      { recursive: true, force: true },
    );
    throw error;
  }
}

async function createArtifact(root, releaseRoot, compiledRoot) {
  const output = validateReleasePath(root, releaseRoot);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  for (const [source, destination] of staticFiles) {
    const target = join(output, ...destination.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, ...source.split("/")), target);
  }
  for (const source of await listCompiledJavaScript(compiledRoot)) {
    const destination = join(output, "dist", relative(compiledRoot, source));
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

async function smokeInstallOffline(artifact, root) {
  const smokeRoot = await mkdtemp(join(tmpdir(), "noutify-package-smoke-"));
  try {
    const target = join(smokeRoot, "Target");
    const copiedArtifact = join(target, "Noutify");
    await mkdir(target, { recursive: true });
    await cp(artifact, copiedArtifact, { recursive: true });
    const result = spawnSync(
      process.execPath,
      [
        join(copiedArtifact, "install.mjs"),
        "--language",
        "en",
        "--agent",
        "codex",
      ],
      {
        cwd: target,
        encoding: "utf8",
        windowsHide: true,
        shell: false,
        env: {
          ...offlineChildEnvironment(
            process.env,
            join(root, "scripts", "offline-network-guard.mjs"),
          ),
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
  const build = await compileIsolatedRuntime(root);
  try {
    const artifact = await createArtifact(
      root,
      join(root, "release", "Noutify"),
      build.output,
    );
    if (runGates) await smokeInstallOffline(artifact, root);
    return artifact;
  } finally {
    await rm(
      validateTemporaryBuildPath(build.temporaryRoot, build.buildRoot),
      { recursive: true, force: true },
    );
  }
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
