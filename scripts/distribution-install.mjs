#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const supportedLanguages = new Set(["en", "es"]);

function defaultArtifactRoot() {
  return dirname(fileURLToPath(import.meta.url));
}

export function parseDistributionArguments(argv) {
  const parsed = { agents: [], memoryLinks: [] };
  const singleOptions = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (
      option !== "--language" &&
      option !== "--project" &&
      option !== "--agent" &&
      option !== "--memory-link"
    ) {
      throw new Error(`unknown argument: ${option}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for ${option}`);
    }
    if (option === "--language" || option === "--project") {
      if (singleOptions.has(option)) throw new Error(`duplicate argument: ${option}`);
      singleOptions.add(option);
    }
    if (option === "--language") parsed.language = value;
    if (option === "--project") parsed.project = value;
    if (option === "--agent") parsed.agents.push(value);
    if (option === "--memory-link") parsed.memoryLinks.push(value);
    index += 1;
  }
  return parsed;
}

async function listArtifactFiles(root) {
  const files = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error("artifact may not contain symbolic links");
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(relative(root, path).replaceAll("\\", "/"));
      } else {
        throw new Error("artifact contains an unsupported filesystem entry");
      }
    }
  }
  await visit(root);
  return files.sort();
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function safeManifestPath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.includes("\\") &&
    !path.startsWith("/") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..") &&
    !path.includes(":") &&
    path !== "manifest.json"
  );
}

export async function validateDistributionArtifact(artifactRoot) {
  const root = resolve(artifactRoot);
  const manifestText = await readFile(join(root, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  if (!exactKeys(manifest, ["formatVersion", "version", "node", "files"])) {
    throw new Error("invalid distribution manifest");
  }
  if (
    manifest.formatVersion !== 1 ||
    manifest.version !== "0.0.1" ||
    manifest.node !== ">=24" ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("unsupported distribution manifest");
  }

  const paths = [];
  for (const entry of manifest.files) {
    if (
      !exactKeys(entry, ["path", "sha256"]) ||
      !safeManifestPath(entry.path) ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error("invalid distribution manifest entry");
    }
    paths.push(entry.path);
  }
  const sortedPaths = [...paths].sort();
  if (
    new Set(paths).size !== paths.length ||
    paths.some((path, index) => path !== sortedPaths[index])
  ) {
    throw new Error("distribution manifest paths must be unique and sorted");
  }

  const actualFiles = await listArtifactFiles(root);
  const expectedFiles = [...paths, "manifest.json"].sort();
  if (
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((path, index) => path !== expectedFiles[index])
  ) {
    throw new Error("distribution files do not match the manifest");
  }

  for (const entry of manifest.files) {
    const bytes = await readFile(join(root, ...entry.path.split("/")));
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== entry.sha256) {
      throw new Error(`distribution file hash mismatch: ${entry.path}`);
    }
  }
  return manifest;
}

function defaultDependencies() {
  return {
    artifactRoot: defaultArtifactRoot(),
    platform: process.platform,
    nodeVersion: process.versions.node,
    nodePath: process.execPath,
    spawn: spawnSync,
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  };
}

function fail(dependencies, message) {
  dependencies.writeStderr(`Noutify installation failed: ${message}\n`);
  return 1;
}

export async function runDistributionInstall(argv, suppliedDependencies = {}) {
  const dependencies = { ...defaultDependencies(), ...suppliedDependencies };
  let parsed;
  try {
    parsed = parseDistributionArguments(argv);
    if (!supportedLanguages.has(parsed.language)) {
      throw new Error(`unsupported language: ${parsed.language ?? ""}`);
    }
    if (parsed.agents.length === 0) {
      throw new Error("at least one --agent is required");
    }
    await validateDistributionArtifact(dependencies.artifactRoot);
    if (dependencies.platform !== "win32") {
      throw new Error("Noutify setup requires Windows");
    }
    if (Number.parseInt(dependencies.nodeVersion, 10) < 24) {
      throw new Error("Node.js 24 or newer is required");
    }
    if (!isAbsolute(dependencies.nodePath)) {
      throw new Error("the current Node.js executable is invalid");
    }
  } catch (error) {
    return fail(
      dependencies,
      error instanceof Error ? error.message : "invalid distribution",
    );
  }

  const artifactRoot = resolve(dependencies.artifactRoot);
  const target = parsed.project === undefined
    ? dirname(artifactRoot)
    : resolve(parsed.project);
  const setupArguments = [
    join(artifactRoot, "dist", "cli.js"),
    "setup",
    "--project",
    target,
    "--language",
    parsed.language,
    ...parsed.agents.flatMap((agent) => ["--agent", agent]),
    ...parsed.memoryLinks.flatMap((link) => ["--memory-link", link]),
    "--format",
    "json",
  ];
  const result = dependencies.spawn(dependencies.nodePath, setupArguments, {
    cwd: artifactRoot,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) {
    let diagnostic = String(result.stderr ?? "");
    if (result.error instanceof Error) diagnostic += `${result.error.message}\n`;
    return fail(dependencies, diagnostic.trim() || `setup exited with ${result.status ?? 1}`);
  }
  dependencies.writeStdout(String(result.stdout ?? ""));
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  runDistributionInstall(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
