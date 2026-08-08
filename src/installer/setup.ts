import { access, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

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
  installClaudeStopHook,
  uninstallClaudeStopHook,
} from "./claude-settings.js";
import {
  hasClaudeSkill,
  installClaudeSkill,
  preflightClaudeSkill,
  removeEmptyClaudeSkillDirectory,
  uninstallClaudeSkill,
} from "./claude-skill.js";
import {
  restoreFileSnapshots,
  snapshotFiles,
} from "./file-snapshot.js";

export interface RuntimePaths {
  nodePath: string;
  cliPath: string;
}

export interface SetupProjectInput extends RuntimePaths {
  projectRoot: string;
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

function quoteArgument(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

export function buildClaudeHookCommand(
  projectRoot: string,
  runtime: RuntimePaths,
): ClaudeHookCommand {
  validateRuntimePaths(runtime);
  return {
    command: runtime.nodePath,
    args: [
      runtime.cliPath,
      "hook",
      "claude-stop",
      "--project",
      resolve(projectRoot),
    ],
  };
}

export function buildLegacyClaudeHookCommand(
  projectRoot: string,
  runtime: RuntimePaths,
): string {
  validateRuntimePaths(runtime);
  return [
    quoteArgument(runtime.nodePath),
    quoteArgument(runtime.cliPath),
    "hook",
    "claude-stop",
    "--project",
    quoteArgument(resolve(projectRoot)),
  ].join(" ");
}

function validateRuntimePaths(runtime: RuntimePaths): void {
  if (!isAbsolute(runtime.nodePath)) {
    throw new Error("runtime nodePath must be absolute");
  }
  if (!isAbsolute(runtime.cliPath)) {
    throw new Error("runtime cliPath must be absolute");
  }
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
  const hookCommand = buildClaudeHookCommand(projectRoot, input);
  const legacyHookCommand = buildLegacyClaudeHookCommand(projectRoot, input);
  await preflightClaudeSkill(projectRoot, input);
  const publicExists = await exists(join(projectRoot, PUBLIC_CONFIG_FILE));
  const privateExists = await exists(join(projectRoot, PRIVATE_CONFIG_FILE));
  const settingsPath = join(projectRoot, ".claude", "settings.local.json");
  const skillDirectory = join(projectRoot, ".claude", "skills", "noutify");
  const skillPath = join(skillDirectory, "SKILL.md");
  const launcherPath = join(skillDirectory, "launcher.mjs");
  const skillDirectoryExisted = await exists(skillDirectory);
  const snapshots = await snapshotFiles([
    join(projectRoot, ".gitignore"),
    join(projectRoot, PUBLIC_CONFIG_FILE),
    join(projectRoot, PRIVATE_CONFIG_FILE),
    settingsPath,
    `${settingsPath}.noutify-backup`,
    skillPath,
    launcherPath,
  ]);
  let created = false;
  let bundle;
  try {
    if (publicExists || privateExists) {
      if (!publicExists || !privateExists) {
        throw new Error(
          "Noutify configuration is incomplete; both public and private files are required",
        );
      }
      bundle = await readProjectConfig(projectRoot);
      await ensurePrivateIgnore(projectRoot);
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
      await writeProjectConfig(projectRoot, bundle);
      created = true;
    }

    const hook = await installClaudeStopHook(
      projectRoot,
      hookCommand,
      [legacyHookCommand],
    );
    const installSkill = dependencies.installSkill ?? installClaudeSkill;
    await installSkill(projectRoot, input);
    return {
      created,
      hookChanged: hook.changed,
      topic: bundle.private.topic,
      language: bundle.private.language,
      server: bundle.private.server,
      hookCommand,
    };
  } catch (error) {
    await restoreFileSnapshots(snapshots);
    const skillSnapshot = snapshots.find((snapshot) => snapshot.path === skillPath);
    if (skillSnapshot?.contents === null && !skillDirectoryExisted) {
      await removeEmptyClaudeSkillDirectory(projectRoot);
    }
    throw error;
  }
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
