import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export const PUBLIC_CONFIG_FILE = "noutify.config.json";
export const PRIVATE_CONFIG_FILE = ".noutify.local.json";

export interface PublicProjectConfig {
  version: 1;
  project: { name: string };
  provider: { type: "ntfy" };
  events: { waiting: boolean };
}

export interface PrivateProjectConfig {
  server: string;
  topic: string;
  setupCompleted: boolean;
}

export interface ProjectConfigBundle {
  public: PublicProjectConfig;
  private: PrivateProjectConfig;
}

export interface InitialConfigInput {
  projectName: string;
  server?: string;
  topic?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new Error(`${context} contains unexpected field: ${unexpected}`);
  }
}

function validateProjectName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 100) {
    throw new Error("project name must contain 1 to 100 characters");
  }
  return value.trim();
}

function validateServer(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("server must be an HTTP or HTTPS URL");
  }

  let server: URL;
  try {
    server = new URL(value);
  } catch {
    throw new Error("server must be an HTTP or HTTPS URL");
  }

  if (server.protocol !== "https:" && server.protocol !== "http:") {
    throw new Error("server must be an HTTP or HTTPS URL");
  }
  return server.toString().replace(/\/$/, "");
}

function validateTopic(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(value)
  ) {
    throw new Error("topic must contain 16 to 128 URL-safe characters");
  }
  return value;
}

export function validateProjectConfig(
  publicValue: unknown,
  privateValue: unknown,
): ProjectConfigBundle {
  if (!isRecord(publicValue) || publicValue.version !== 1) {
    throw new Error("public config version must be 1");
  }
  assertOnlyKeys(
    publicValue,
    ["version", "project", "provider", "events"],
    "public config",
  );
  if (!isRecord(publicValue.project)) {
    throw new Error("public config project is required");
  }
  assertOnlyKeys(publicValue.project, ["name"], "public config project");
  if (
    !isRecord(publicValue.provider) ||
    publicValue.provider.type !== "ntfy"
  ) {
    throw new Error("public config provider must be ntfy");
  }
  assertOnlyKeys(publicValue.provider, ["type"], "public config provider");
  if (
    !isRecord(publicValue.events) ||
    typeof publicValue.events.waiting !== "boolean"
  ) {
    throw new Error("public config events.waiting must be boolean");
  }
  assertOnlyKeys(publicValue.events, ["waiting"], "public config events");
  if (!isRecord(privateValue)) {
    throw new Error("private config is required");
  }
  assertOnlyKeys(
    privateValue,
    ["server", "topic", "setupCompleted"],
    "private config",
  );
  if (typeof privateValue.setupCompleted !== "boolean") {
    throw new Error("private config setupCompleted must be boolean");
  }

  return {
    public: {
      version: 1,
      project: { name: validateProjectName(publicValue.project.name) },
      provider: { type: "ntfy" },
      events: { waiting: publicValue.events.waiting },
    },
    private: {
      server: validateServer(privateValue.server),
      topic: validateTopic(privateValue.topic),
      setupCompleted: privateValue.setupCompleted,
    },
  };
}

export function createInitialConfig(
  input: InitialConfigInput,
): ProjectConfigBundle {
  const topic = input.topic ?? randomBytes(18).toString("base64url");
  return validateProjectConfig(
    {
      version: 1,
      project: { name: input.projectName },
      provider: { type: "ntfy" },
      events: { waiting: true },
    },
    {
      server: input.server ?? "https://ntfy.sh",
      topic,
      setupCompleted: false,
    },
  );
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

interface FileSnapshot {
  path: string;
  contents: string | null;
}

async function snapshotFile(path: string): Promise<FileSnapshot> {
  try {
    return { path, contents: await readFile(path, "utf8") };
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return { path, contents: null };
    }
    throw error;
  }
}

async function restoreFile(snapshot: FileSnapshot): Promise<void> {
  if (snapshot.contents === null) {
    await unlink(snapshot.path).catch((error: unknown) => {
      if (!isRecord(error) || error.code !== "ENOENT") throw error;
    });
    return;
  }
  await writeFile(snapshot.path, snapshot.contents, "utf8");
}

export async function writeProjectConfig(
  projectRoot: string,
  bundle: ProjectConfigBundle,
): Promise<void> {
  const validated = validateProjectConfig(bundle.public, bundle.private);
  await mkdir(projectRoot, { recursive: true });
  const publicPath = join(projectRoot, PUBLIC_CONFIG_FILE);
  const privatePath = join(projectRoot, PRIVATE_CONFIG_FILE);
  const ignorePath = join(projectRoot, ".gitignore");
  const snapshots = await Promise.all(
    [ignorePath, publicPath, privatePath].map(snapshotFile),
  );

  try {
    // Protect the private path before it can ever appear on disk.
    await ensurePrivateIgnore(projectRoot);
    await writeJsonAtomic(publicPath, validated.public);
    await writeJsonAtomic(privatePath, validated.private);
  } catch (error) {
    await Promise.all(snapshots.map(restoreFile));
    throw error;
  }
}

export async function readProjectConfig(
  projectRoot: string,
): Promise<ProjectConfigBundle> {
  const [publicText, privateText] = await Promise.all([
    readFile(join(projectRoot, PUBLIC_CONFIG_FILE), "utf8"),
    readFile(join(projectRoot, PRIVATE_CONFIG_FILE), "utf8"),
  ]);
  return validateProjectConfig(JSON.parse(publicText), JSON.parse(privateText));
}

export async function ensurePrivateIgnore(projectRoot: string): Promise<void> {
  const ignorePath = join(projectRoot, ".gitignore");
  const existing = await readFile(ignorePath, "utf8").catch(
    (error: unknown) => {
      if (
        isRecord(error) &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return "";
      }
      throw error;
    },
  );
  const lines = existing.split(/\r?\n/);
  if (lines.includes(PRIVATE_CONFIG_FILE)) {
    return;
  }

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(
    ignorePath,
    `${existing}${prefix}${PRIVATE_CONFIG_FILE}\n`,
    "utf8",
  );
}
