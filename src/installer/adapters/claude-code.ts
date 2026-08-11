import { isAbsolute, resolve } from "node:path";

import {
  countClaudeStopHooks,
  installClaudeStopHook,
  uninstallClaudeStopHook,
  type ClaudeHookCommand,
} from "../claude-settings.js";
import {
  hasClaudeSkill,
  installClaudeSkill,
  preflightClaudeSkill,
  uninstallClaudeSkill,
} from "../claude-skill.js";
import type {
  AdapterContext,
  AgentAdapter,
  RuntimePaths,
} from "../agent-adapter.js";

const PUBLIC_PATH = ".claude/settings.local.json";

export interface ClaudeCodeAdapterDependencies {
  installSkill?: typeof installClaudeSkill;
}

function quoteArgument(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function validateRuntimePaths(runtime: RuntimePaths): void {
  if (!isAbsolute(runtime.nodePath)) {
    throw new Error("runtime nodePath must be absolute");
  }
  if (!isAbsolute(runtime.cliPath)) {
    throw new Error("runtime cliPath must be absolute");
  }
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

function commands(context: AdapterContext): {
  current: ClaudeHookCommand;
  legacy: string;
} {
  return {
    current: buildClaudeHookCommand(context.projectRoot, context.runtime),
    legacy: buildLegacyClaudeHookCommand(context.projectRoot, context.runtime),
  };
}

export function createClaudeCodeAdapter(
  dependencies: ClaudeCodeAdapterDependencies = {},
): AgentAdapter {
  return {
    id: "claude-code",
    mode: "native",
    publicPath: PUBLIC_PATH,
    ownedPaths: () => [
      PUBLIC_PATH,
      `${PUBLIC_PATH}.noutify-backup`,
      ".claude/skills/noutify/SKILL.md",
      ".claude/skills/noutify/launcher.mjs",
    ],
    preflight: async (context) => {
      const hook = commands(context);
      await Promise.all([
        countClaudeStopHooks(context.projectRoot, hook.current, [hook.legacy]),
        preflightClaudeSkill(context.projectRoot, context.runtime),
      ]);
    },
    install: async (context) => {
      const hook = commands(context);
      const hookResult = await installClaudeStopHook(
        context.projectRoot,
        hook.current,
        [hook.legacy],
      );
      const skillResult = await (dependencies.installSkill ?? installClaudeSkill)(
        context.projectRoot,
        context.runtime,
      );
      return { changed: hookResult.changed || skillResult.changed };
    },
    inspect: async (context) => {
      const hook = commands(context);
      const [currentHookCount, ownedHookCount, skillInstalled] = await Promise.all([
        countClaudeStopHooks(context.projectRoot, hook.current),
        countClaudeStopHooks(context.projectRoot, hook.current, [hook.legacy]),
        hasClaudeSkill(context.projectRoot, context.runtime),
      ]);
      const installed =
        currentHookCount === 1 &&
        ownedHookCount === currentHookCount &&
        skillInstalled;
      return {
        installed,
        detail: installed
          ? "Claude Code integration is installed"
          : "Claude Code integration is missing or modified",
      };
    },
    uninstall: async (context) => {
      const hook = commands(context);
      const [hookResult, skillResult] = await Promise.all([
        uninstallClaudeStopHook(context.projectRoot, hook.current, [hook.legacy]),
        uninstallClaudeSkill(context.projectRoot, context.runtime),
      ]);
      return { changed: hookResult.changed || skillResult.changed };
    },
  };
}

export const claudeCodeAdapter = createClaudeCodeAdapter();
