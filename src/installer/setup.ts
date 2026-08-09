import { access, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  PRIVATE_CONFIG_FILE,
  PUBLIC_CONFIG_FILE,
  createInitialConfig,
  readProjectConfig,
  writeProjectConfig,
} from "../config/project-config.js";
import {
  normalizeNotificationLanguage,
  type NotificationLanguage,
} from "../config/language.js";
import {
  normalizeIntegrations,
  parseAgentId,
  type AgentId,
  type IntegrationConfig,
  type NativeAgentId,
} from "../config/integrations.js";
import { notificationCopy } from "../core/notification-catalog.js";
import type { Notification } from "../core/types.js";
import {
  type NtfyConfig,
  type SendResult,
  sendNtfy,
} from "../providers/ntfy.js";
import {
  installClaudeSkill,
  removeEmptyClaudeSkillDirectory,
} from "./claude-skill.js";
import {
  nativeAdapter,
  type AdapterContext,
  type AgentAdapter,
  type RuntimePaths,
} from "./agent-adapter.js";
import type { MemoryLink } from "./agent-memory.js";
import {
  buildClaudeHookCommand,
  buildLegacyClaudeHookCommand,
  createClaudeCodeAdapter,
} from "./adapters/claude-code.js";
import { createGenericMemoryAdapter } from "./adapters/generic-memory.js";
import {
  restoreFileSnapshots,
  snapshotFiles,
} from "./file-snapshot.js";

export type { RuntimePaths } from "./agent-adapter.js";
export {
  buildClaudeHookCommand,
  buildLegacyClaudeHookCommand,
} from "./adapters/claude-code.js";

export interface SetupProjectInput extends RuntimePaths {
  projectRoot: string;
  agents?: readonly AgentId[];
  memoryLinks?: readonly MemoryLink[];
  projectName?: string;
  server?: string;
  topic?: string;
  language?: NotificationLanguage;
}

export interface IntegrationSetupResult {
  agent: AgentId;
  mode: IntegrationConfig["mode"];
  status: "installed" | "pending";
}

export type SetupProjectResult =
  | {
      created: true;
      topic: string;
      language: NotificationLanguage;
      server: string;
      integrations: IntegrationSetupResult[];
    }
  | {
      created: false;
      language: NotificationLanguage;
      server: string;
      integrations: IntegrationSetupResult[];
    };

export interface SetupDependencies {
  installSkill?: typeof installClaudeSkill;
  adapters?: readonly AgentAdapter[];
}

export type NotificationSender = (
  notification: Notification,
  config: NtfyConfig,
) => Promise<SendResult>;

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function setupProject(
  input: SetupProjectInput,
  dependencies: SetupDependencies = {},
): Promise<SetupProjectResult> {
  const projectRoot = resolve(input.projectRoot);
  const selectedAgents = input.agents ?? (["claude-code"] as const);
  if (selectedAgents.length === 0) {
    throw new Error("at least one agent is required");
  }
  const adapters = setupAdapters(
    selectedAgents,
    input.memoryLinks ?? [],
    dependencies,
  ).sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const runtime: RuntimePaths = {
    nodePath: input.nodePath,
    cliPath: input.cliPath,
  };
  const contexts = adapters.map<{
    adapter: AgentAdapter;
    context: AdapterContext;
  }>((adapter) => ({
    adapter,
    context: { projectRoot, runtime },
  }));
  await Promise.all(
    contexts.map(({ adapter, context }) => adapter.preflight(context)),
  );

  const publicExists = await exists(join(projectRoot, PUBLIC_CONFIG_FILE));
  const privateExists = await exists(join(projectRoot, PRIVATE_CONFIG_FILE));
  const skillDirectory = join(projectRoot, ".claude", "skills", "noutify");
  const skillPath = join(skillDirectory, "SKILL.md");
  const skillDirectoryExisted = await exists(skillDirectory);
  const snapshotPaths = new Set([
    join(projectRoot, ".gitignore"),
    join(projectRoot, PUBLIC_CONFIG_FILE),
    join(projectRoot, PRIVATE_CONFIG_FILE),
    ...contexts.flatMap(({ adapter, context }) =>
      adapter.ownedPaths(context).map((path) => join(projectRoot, path)),
    ),
  ]);
  const snapshots = await snapshotFiles([...snapshotPaths]);
  let bundle: ReturnType<typeof createInitialConfig>;
  try {
    if (publicExists || privateExists) {
      if (!publicExists || !privateExists) {
        throw new Error(
          "Noutify configuration is incomplete; both public and private files are required",
        );
      }
      const storedPublic = JSON.parse(
        await readFile(join(projectRoot, PUBLIC_CONFIG_FILE), "utf8"),
      ) as { version?: unknown };
      const migratingV1 = storedPublic.version === 1;
      bundle = await readProjectConfig(projectRoot);
      const integrations = new Map(
        bundle.public.integrations.map((integration) => [
          integration.agent,
          integration,
        ]),
      );
      for (const adapter of adapters) {
        integrations.set(adapter.id, adapterIntegration(adapter));
      }
      bundle.public.integrations = normalizeIntegrations([
        ...integrations.values(),
      ]);
      const results = await installAdapters(contexts);
      await writeProjectConfig(projectRoot, bundle, {
        preserveValues: migratingV1,
      });
      return {
        created: false,
        language: bundle.private.language,
        server: bundle.private.server,
        integrations: results,
      };
    } else {
      const initialInput: {
        projectName: string;
        server?: string;
        topic?: string;
        language?: NotificationLanguage;
      } = {
        projectName: input.projectName?.trim() || basename(projectRoot),
      };
      if (input.server !== undefined) initialInput.server = input.server;
      if (input.topic !== undefined) initialInput.topic = input.topic;
      if (input.language !== undefined) initialInput.language = input.language;
      bundle = createInitialConfig(initialInput);
      bundle.public.integrations = normalizeIntegrations(
        adapters.map(adapterIntegration),
      );
    }

    const integrations = await installAdapters(contexts);
    await writeProjectConfig(projectRoot, bundle);
    return {
      created: true,
      topic: bundle.private.topic,
      language: bundle.private.language,
      server: bundle.private.server,
      integrations,
    };
  } catch (error) {
    await restoreFileSnapshots(snapshots);
    const skillSnapshot = snapshots.find((snapshot) => snapshot.path === skillPath);
    if (
      adapters.some((adapter) => adapter.id === "claude-code") &&
      skillSnapshot?.contents === null &&
      !skillDirectoryExisted
    ) {
      await removeEmptyClaudeSkillDirectory(projectRoot);
    }
    throw error;
  }
}

async function installAdapters(
  contexts: readonly { adapter: AgentAdapter; context: AdapterContext }[],
): Promise<IntegrationSetupResult[]> {
  const results: IntegrationSetupResult[] = [];
  for (const { adapter, context } of contexts) {
    const mutation = await adapter.install(context);
    results.push({
      agent: adapter.id,
      mode: adapter.mode,
      status: mutation.pending === true ? "pending" : "installed",
    });
  }
  return results;
}

function setupAdapters(
  agents: readonly AgentId[],
  memoryLinks: readonly MemoryLink[],
  dependencies: SetupDependencies,
): AgentAdapter[] {
  const selected = new Set(agents);
  if (selected.size !== agents.length) {
    throw new Error("duplicate agent selection");
  }
  const links = new Map<AgentId, MemoryLink>();
  for (const link of memoryLinks) {
    if (!selected.has(link.agent)) {
      throw new Error(`memory link agent is not selected: ${link.agent}`);
    }
    if (!link.agent.startsWith("generic:")) {
      throw new Error(`memory link requires a generic agent: ${link.agent}`);
    }
    if (links.has(link.agent)) {
      throw new Error(`duplicate memory link for ${link.agent}`);
    }
    links.set(link.agent, link);
  }
  const overrides = new Map<AgentId, AgentAdapter>();
  for (const adapter of dependencies.adapters ?? []) {
    if (overrides.has(adapter.id)) {
      throw new Error(`duplicate adapter override: ${adapter.id}`);
    }
    overrides.set(adapter.id, adapter);
  }
  return agents.map((agent) => {
    const override = overrides.get(agent);
    if (override !== undefined) return override;
    if (agent.startsWith("generic:")) {
      return createGenericMemoryAdapter(agent, links.get(agent)?.relativePath);
    }
    const adapter = nativeAdapter(agent as NativeAgentId);
    return agent === "claude-code" && dependencies.installSkill !== undefined
      ? createClaudeCodeAdapter({ installSkill: dependencies.installSkill })
      : adapter;
  });
}

function adapterIntegration(adapter: AgentAdapter): IntegrationConfig {
  return adapter.publicPath === undefined
    ? { agent: adapter.id, mode: adapter.mode }
    : { agent: adapter.id, mode: adapter.mode, path: adapter.publicPath };
}

export async function setProjectLanguage(
  projectRoot: string,
  value: string,
): Promise<NotificationLanguage> {
  const root = resolve(projectRoot);
  const bundle = await readProjectConfig(root);
  const language = normalizeNotificationLanguage(value);
  bundle.private.language = language;
  await writeProjectConfig(root, bundle);
  return language;
}

export async function testProject(
  projectRoot: string,
  sender: NotificationSender = sendNtfy,
): Promise<SendResult> {
  const bundle = await readProjectConfig(resolve(projectRoot));
  const copy = notificationCopy(bundle.private.language);
  const notification: Notification = {
    title: copy.testTitle,
    message: copy.testMessage(bundle.public.project.name),
    tags: ["white_check_mark"],
    priority: "default",
  };
  return sender(notification, bundle.private);
}

export async function confirmProject(projectRoot: string): Promise<void> {
  const root = resolve(projectRoot);
  const bundle = await readProjectConfig(root);
  bundle.private.setupCompleted = true;
  await writeProjectConfig(root, bundle);
}

export async function confirmAgent(
  projectRoot: string,
  agentValue: string,
): Promise<void> {
  const root = resolve(projectRoot);
  const agent = parseAgentId(agentValue);
  const bundle = await readProjectConfig(root);
  if (!bundle.public.integrations.some((entry) => entry.agent === agent)) {
    throw new Error(`agent integration is not selected: ${agent}`);
  }
  bundle.private.automaticReceipts[agent] = true;
  await writeProjectConfig(root, bundle);
}

export async function doctorProject(
  projectRoot: string,
  runtime: RuntimePaths,
): Promise<DoctorResult> {
  const root = resolve(projectRoot);
  const checks: DoctorCheck[] = [];
  let bundle: Awaited<ReturnType<typeof readProjectConfig>> | undefined;

  try {
    bundle = await readProjectConfig(root);
    checks.push({
      name: "configuration",
      status: "pass",
      message: "public and private configuration are valid",
    });
  } catch {
    checks.push({
      name: "configuration",
      status: "fail",
      message: "configuration is missing or invalid",
    });
  }

  const ignoreText = await readFile(join(root, ".gitignore"), "utf8").catch(
    () => "",
  );
  const privateIgnored = ignoreText.split(/\r?\n/).includes(PRIVATE_CONFIG_FILE);
  checks.push({
    name: "private-ignore",
    status: privateIgnored ? "pass" : "fail",
    message: privateIgnored
      ? "private configuration is ignored by Git"
      : "private configuration is not ignored by Git",
  });

  if (bundle !== undefined) {
    const confirmed = bundle.private.setupCompleted;
    checks.push({
      name: "phone-receipt",
      status: confirmed ? "pass" : "warn",
      message: confirmed
        ? "phone receipt was confirmed"
        : "phone receipt has not been confirmed",
    });

    for (const integration of bundle.public.integrations) {
      try {
        const adapter = adapterFromIntegration(integration);
        const inspection = await adapter.inspect({ projectRoot: root, runtime });
        const pending =
          integration.mode === "memory" &&
          integration.path === undefined &&
          inspection.detail.includes("pending");
        checks.push({
          name: `${integration.agent}-integration`,
          status: inspection.installed ? "pass" : pending ? "warn" : "fail",
          message: inspection.detail,
        });
      } catch {
        checks.push({
          name: `${integration.agent}-integration`,
          status: "fail",
          message: `${integration.agent} integration is unavailable or invalid`,
        });
      }

      const receiptConfirmed =
        bundle.private.automaticReceipts[integration.agent] === true;
      checks.push({
        name: `${integration.agent}-automatic-receipt`,
        status: receiptConfirmed ? "pass" : "warn",
        message: receiptConfirmed
          ? "automatic delivery receipt is confirmed"
          : "automatic delivery receipt has not been confirmed",
      });
    }
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
  };
}

export async function uninstallProject(
  projectRoot: string,
  runtime: RuntimePaths,
): Promise<{ changed: boolean; configPreserved: true }> {
  const root = resolve(projectRoot);
  const bundle = await readProjectConfig(root);
  const contexts = bundle.public.integrations
    .map((integration) => ({
      adapter: adapterFromIntegration(integration),
      context: { projectRoot: root, runtime },
    }))
    .sort((left, right) =>
      left.adapter.id < right.adapter.id
        ? -1
        : left.adapter.id > right.adapter.id
          ? 1
          : 0,
    );
  await Promise.all(
    contexts.map(({ adapter, context }) => adapter.preflight(context)),
  );
  const snapshotPaths = new Set(
    contexts.flatMap(({ adapter, context }) =>
      adapter.ownedPaths(context).map((path) => join(root, path)),
    ),
  );
  const snapshots = await snapshotFiles([...snapshotPaths]);
  let changed = false;
  try {
    for (const { adapter, context } of contexts) {
      const result = await adapter.uninstall(context);
      changed ||= result.changed;
    }
  } catch (error) {
    await restoreFileSnapshots(snapshots);
    throw error;
  }
  return { changed, configPreserved: true };
}

function adapterFromIntegration(integration: IntegrationConfig): AgentAdapter {
  return integration.agent.startsWith("generic:")
    ? createGenericMemoryAdapter(integration.agent, integration.path)
    : nativeAdapter(integration.agent as NativeAgentId);
}
