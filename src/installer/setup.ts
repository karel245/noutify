import { access, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  PRIVATE_CONFIG_FILE,
  PUBLIC_CONFIG_FILE,
  createInitialConfig,
  ensurePrivateIgnore,
  readProjectConfig,
  writeProjectConfig,
} from "../config/project-config.js";
import {
  normalizeNotificationLanguage,
  type NotificationLanguage,
} from "../config/language.js";
import {
  normalizeIntegrations,
  type AgentId,
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
  type ClaudeHookCommand,
  countClaudeStopHooks,
  uninstallClaudeStopHook,
} from "./claude-settings.js";
import {
  hasClaudeSkill,
  installClaudeSkill,
  removeEmptyClaudeSkillDirectory,
  uninstallClaudeSkill,
} from "./claude-skill.js";
import {
  nativeAdapter,
  type AdapterContext,
  type AgentAdapter,
  type RuntimePaths,
} from "./agent-adapter.js";
import {
  buildClaudeHookCommand,
  buildLegacyClaudeHookCommand,
  createClaudeCodeAdapter,
} from "./adapters/claude-code.js";
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
  projectName?: string;
  server?: string;
  topic?: string;
  language?: NotificationLanguage;
}

export interface SetupProjectResult {
  created: boolean;
  hookChanged: boolean;
  topic: string;
  language: NotificationLanguage;
  server: string;
  hookCommand: ClaudeHookCommand;
}

export interface SetupDependencies {
  installSkill?: typeof installClaudeSkill;
}

export type NotificationSender = (
  notification: Notification,
  config: NtfyConfig,
) => Promise<SendResult>;

export interface DoctorCheck {
  name:
    | "configuration"
    | "private-ignore"
    | "claude-stop-hook"
    | "claude-skill"
    | "confirmed";
  ok: boolean;
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
  const adapters = setupAdapters(selectedAgents, dependencies);
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

  const hookCommand = buildClaudeHookCommand(projectRoot, runtime);
  const legacyHookCommand = buildLegacyClaudeHookCommand(projectRoot, runtime);
  let hookChanged = false;
  if (adapters.some((adapter) => adapter.id === "claude-code")) {
    const [currentHookCount, ownedHookCount] = await Promise.all([
      countClaudeStopHooks(projectRoot, hookCommand),
      countClaudeStopHooks(projectRoot, hookCommand, [legacyHookCommand]),
    ]);
    hookChanged = currentHookCount !== 1 || ownedHookCount !== currentHookCount;
  }

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
  let created = false;
  let bundle;
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
      await ensurePrivateIgnore(projectRoot);
      const integrations = new Map(
        bundle.public.integrations.map((integration) => [
          integration.agent,
          integration,
        ]),
      );
      for (const adapter of adapters) {
        integrations.set(adapter.id, {
          agent: adapter.id,
          mode: adapter.mode,
          path: adapter.publicPath,
        });
      }
      bundle.public.integrations = normalizeIntegrations([
        ...integrations.values(),
      ]);
      await writeProjectConfig(projectRoot, bundle, {
        preserveValues: migratingV1,
      });
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
        adapters.map((adapter) => ({
          agent: adapter.id,
          mode: adapter.mode,
          path: adapter.publicPath,
        })),
      );
      await writeProjectConfig(projectRoot, bundle);
      created = true;
    }

    for (const { adapter, context } of contexts) {
      await adapter.install(context);
    }
    return {
      created,
      hookChanged,
      topic: bundle.private.topic,
      language: bundle.private.language,
      server: bundle.private.server,
      hookCommand,
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

function setupAdapters(
  agents: readonly AgentId[],
  dependencies: SetupDependencies,
): AgentAdapter[] {
  return agents.map((agent) => {
    if (agent.startsWith("generic:")) {
      throw new Error(`agent adapter is not available: ${agent}`);
    }
    const adapter = nativeAdapter(agent as NativeAgentId);
    return agent === "claude-code" && dependencies.installSkill !== undefined
      ? createClaudeCodeAdapter({ installSkill: dependencies.installSkill })
      : adapter;
  });
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

export async function doctorProject(
  projectRoot: string,
  runtime: RuntimePaths,
): Promise<DoctorResult> {
  const root = resolve(projectRoot);
  const hookCommand = buildClaudeHookCommand(root, runtime);
  const legacyHookCommand = buildLegacyClaudeHookCommand(root, runtime);
  const checks: DoctorCheck[] = [];
  let bundle;

  try {
    bundle = await readProjectConfig(root);
    checks.push({
      name: "configuration",
      ok: true,
      message: "public and private configuration are valid",
    });
  } catch {
    checks.push({
      name: "configuration",
      ok: false,
      message: "configuration is missing or invalid",
    });
  }

  const ignoreText = await readFile(join(root, ".gitignore"), "utf8").catch(
    () => "",
  );
  checks.push({
    name: "private-ignore",
    ok: ignoreText.split(/\r?\n/).includes(PRIVATE_CONFIG_FILE),
    message: ignoreText.split(/\r?\n/).includes(PRIVATE_CONFIG_FILE)
      ? "private configuration is ignored by Git"
      : "private configuration is not ignored by Git",
  });

  const [currentHookCount, ownedHookCount] = await Promise.all([
    countClaudeStopHooks(root, hookCommand),
    countClaudeStopHooks(root, hookCommand, [legacyHookCommand]),
  ]).catch(() => [0, 0]);
  const legacyHookCount = ownedHookCount - currentHookCount;
  const hookInstalled = currentHookCount === 1 && legacyHookCount === 0;
  checks.push({
    name: "claude-stop-hook",
    ok: hookInstalled,
    message: hookInstalled
      ? "Claude Code Stop hook is installed"
      : currentHookCount === 0 && legacyHookCount > 0
        ? `expected one current Noutify Stop hook; found ${legacyHookCount} legacy`
        : `expected one Noutify Stop hook; found ${ownedHookCount}`,
  });

  const skillInstalled = await hasClaudeSkill(root, runtime).catch(() => false);
  checks.push({
    name: "claude-skill",
    ok: skillInstalled,
    message: skillInstalled
      ? "Claude Code Noutify skill is installed"
      : "Claude Code Noutify skill is missing or modified",
  });

  const confirmed = bundle?.private.setupCompleted === true;
  checks.push({
    name: "confirmed",
    ok: confirmed,
    message: confirmed
      ? "phone receipt was confirmed"
      : "phone receipt has not been confirmed",
  });

  return { ok: checks.every((check) => check.ok), checks };
}

export async function uninstallProject(
  projectRoot: string,
  runtime: RuntimePaths,
): Promise<{ changed: boolean; configPreserved: true }> {
  const root = resolve(projectRoot);
  const command = buildClaudeHookCommand(root, runtime);
  const legacyCommand = buildLegacyClaudeHookCommand(root, runtime);
  const [hook, skill] = await Promise.all([
    uninstallClaudeStopHook(root, command, [legacyCommand]),
    uninstallClaudeSkill(root, runtime),
  ]);
  return { changed: hook.changed || skill.changed, configPreserved: true };
}
