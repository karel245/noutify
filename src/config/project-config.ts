import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  validateStoredLanguage,
  type NotificationLanguage,
} from "./language.js";
import {
  normalizeIntegrations,
  parseAgentId,
  type AgentId,
  type IntegrationConfig,
} from "./integrations.js";
import { generateFriendlyTopic } from "./topic.js";
import {
  assertSafeProjectPath,
  assertSafeProjectPaths,
} from "../core/project-path.js";
import {
  restoreFileSnapshots,
  snapshotFiles,
} from "../installer/file-snapshot.js";

export const PUBLIC_CONFIG_FILE = "noutify.config.json";
export const PRIVATE_CONFIG_FILE = ".noutify.local.json";

export interface PublicProjectConfig {
  version: 2;
  project: { name: string };
  provider: { type: "ntfy" };
  events: { waiting: boolean };
  integrations: IntegrationConfig[];
}

export interface PrivateProjectConfig {
  server: string;
  topic: string;
  language: NotificationLanguage;
  setupCompleted: boolean;
  automaticReceipts: Partial<Record<AgentId, true>>;
}

export interface ProjectConfigBundle {
  public: PublicProjectConfig;
  private: PrivateProjectConfig;
}

export interface InitialConfigInput {
  projectName: string;
  server?: string;
  topic?: string;
  language?: NotificationLanguage;
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

function validatePublicFields(
  value: Record<string, unknown>,
  preserveValues = false,
): {
  project: { name: string };
  provider: { type: "ntfy" };
  events: { waiting: boolean };
} {
  if (!isRecord(value.project)) {
    throw new Error("public config project is required");
  }
  assertOnlyKeys(value.project, ["name"], "public config project");
  if (
    !isRecord(value.provider) ||
    value.provider.type !== "ntfy"
  ) {
    throw new Error("public config provider must be ntfy");
  }
  assertOnlyKeys(value.provider, ["type"], "public config provider");
  if (
    !isRecord(value.events) ||
    typeof value.events.waiting !== "boolean"
  ) {
    throw new Error("public config events.waiting must be boolean");
  }
  assertOnlyKeys(value.events, ["waiting"], "public config events");
  const projectName = validateProjectName(value.project.name);
  return {
    project: {
      name: preserveValues
        ? value.project.name as string
        : projectName,
    },
    provider: { type: "ntfy" },
    events: { waiting: value.events.waiting },
  };
}

function validatePrivateFields(
  value: Record<string, unknown>,
  preserveValues = false,
): Omit<
  PrivateProjectConfig,
  "automaticReceipts"
> {
  if (typeof value.setupCompleted !== "boolean") {
    throw new Error("private config setupCompleted must be boolean");
  }
  const server = validateServer(value.server);
  return {
    server: preserveValues ? value.server as string : server,
    topic: validateTopic(value.topic),
    language: validateStoredLanguage(value.language),
    setupCompleted: value.setupCompleted,
  };
}

function validateAutomaticReceipts(
  value: unknown,
): Partial<Record<AgentId, true>> {
  if (!isRecord(value)) {
    throw new Error("private config automaticReceipts must be an object");
  }
  const receipts: Partial<Record<AgentId, true>> = {};
  for (const [agent, enabled] of Object.entries(value)) {
    const agentId = parseAgentId(agent);
    if (enabled !== true) {
      throw new Error("private config automaticReceipts values must be true");
    }
    receipts[agentId] = true;
  }
  return receipts;
}

export function validateProjectConfig(
  publicValue: unknown,
  privateValue: unknown,
): ProjectConfigBundle {
  if (!isRecord(publicValue) || (publicValue.version !== 1 && publicValue.version !== 2)) {
    throw new Error("public config version must be 1 or 2");
  }
  if (!isRecord(privateValue)) {
    throw new Error("private config is required");
  }

  if (publicValue.version === 1) {
    assertOnlyKeys(
      publicValue,
      ["version", "project", "provider", "events"],
      "public config",
    );
    assertOnlyKeys(
      privateValue,
      ["server", "topic", "language", "setupCompleted"],
      "private config",
    );
    return {
      public: {
        version: 2,
        ...validatePublicFields(publicValue, true),
        integrations: [{ agent: "claude-code", mode: "native" }],
      },
      private: {
        ...validatePrivateFields(privateValue, true),
        automaticReceipts: {},
      },
    };
  }

  assertOnlyKeys(
    publicValue,
    ["version", "project", "provider", "events", "integrations"],
    "public config",
  );
  if (!Array.isArray(publicValue.integrations)) {
    throw new Error("public config integrations must be an array");
  }
  assertOnlyKeys(
    privateValue,
    ["server", "topic", "language", "setupCompleted", "automaticReceipts"],
    "private config",
  );

  return {
    public: {
      version: 2,
      ...validatePublicFields(publicValue),
      integrations: normalizeIntegrations(publicValue.integrations as IntegrationConfig[]),
    },
    private: {
      ...validatePrivateFields(privateValue),
      automaticReceipts: validateAutomaticReceipts(privateValue.automaticReceipts),
    },
  };
}

export function createInitialConfig(
  input: InitialConfigInput,
): ProjectConfigBundle {
  const topic = input.topic ?? generateFriendlyTopic();
  return validateProjectConfig(
    {
      version: 2,
      project: { name: input.projectName },
      provider: { type: "ntfy" },
      events: { waiting: true },
      integrations: [{ agent: "claude-code", mode: "native" }],
    },
    {
      server: input.server ?? "https://ntfy.sh",
      topic,
      language: input.language ?? "en",
      setupCompleted: false,
      automaticReceipts: {},
    },
  );
}

async function writeTextAtomic(
  projectRoot: string,
  path: string,
  contents: string,
): Promise<void> {
  await assertSafeProjectPath(projectRoot, path);
  await mkdir(dirname(path), { recursive: true });
  await assertSafeProjectPath(projectRoot, path);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await assertSafeProjectPath(projectRoot, temporaryPath);
    await writeFile(temporaryPath, contents, "utf8");
    await assertSafeProjectPath(projectRoot, temporaryPath);
    await assertSafeProjectPath(projectRoot, path);
    await rename(temporaryPath, path);
  } finally {
    await assertSafeProjectPath(projectRoot, temporaryPath);
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function writeJsonAtomic(
  projectRoot: string,
  path: string,
  value: unknown,
): Promise<void> {
  await writeTextAtomic(
    projectRoot,
    path,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

export async function writeProjectConfig(
  projectRoot: string,
  bundle: ProjectConfigBundle,
  options: { preserveValues?: boolean } = {},
): Promise<void> {
  const validated = validateProjectConfig(bundle.public, bundle.private);
  if (options.preserveValues === true) {
    validated.public.project.name = bundle.public.project.name;
    validated.private.server = bundle.private.server;
  }
  await mkdir(projectRoot, { recursive: true });
  const publicPath = join(projectRoot, PUBLIC_CONFIG_FILE);
  const privatePath = join(projectRoot, PRIVATE_CONFIG_FILE);
  const ignorePath = join(projectRoot, ".gitignore");
  const paths = [ignorePath, publicPath, privatePath];
  await assertSafeProjectPaths(projectRoot, paths);
  const snapshots = await snapshotFiles(projectRoot, paths);

  try {
    // Protect the private path before it can ever appear on disk.
    await ensurePrivateIgnore(projectRoot);
    await writeJsonAtomic(projectRoot, publicPath, validated.public);
    await writeJsonAtomic(projectRoot, privatePath, validated.private);
  } catch (error) {
    await restoreFileSnapshots(projectRoot, snapshots);
    throw error;
  }
}

export async function readProjectConfig(
  projectRoot: string,
): Promise<ProjectConfigBundle> {
  await assertSafeProjectPaths(projectRoot, [
    join(projectRoot, PUBLIC_CONFIG_FILE),
    join(projectRoot, PRIVATE_CONFIG_FILE),
  ]);
  const [publicText, privateText] = await Promise.all([
    readFile(join(projectRoot, PUBLIC_CONFIG_FILE), "utf8"),
    readFile(join(projectRoot, PRIVATE_CONFIG_FILE), "utf8"),
  ]);
  return validateProjectConfig(JSON.parse(publicText), JSON.parse(privateText));
}

export async function ensurePrivateIgnore(projectRoot: string): Promise<void> {
  await ensureIgnoreRules(projectRoot, [PRIVATE_CONFIG_FILE]);
}

export async function ensureIgnoreRules(
  projectRoot: string,
  rules: readonly string[],
): Promise<void> {
  const ignorePath = join(projectRoot, ".gitignore");
  await assertSafeProjectPath(projectRoot, ignorePath);
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
  const lines = new Set(existing.split(/\r?\n/));
  const missing: string[] = [];
  for (const rule of rules) {
    if (!rule || /[\r\n]/.test(rule)) {
      throw new Error("gitignore rule must be one non-empty line");
    }
    if (!lines.has(rule)) {
      lines.add(rule);
      missing.push(rule);
    }
  }
  if (missing.length === 0) return;

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeTextAtomic(
    projectRoot,
    ignorePath,
    `${existing}${prefix}${missing.join("\n")}\n`,
  );
}
