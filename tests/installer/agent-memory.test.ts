import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  installMemoryIntegration,
  parseMemoryLink,
  uninstallMemoryIntegration,
} from "../../src/installer/agent-memory.js";

const temporaryRoots: string[] = [];
const runtime = {
  nodePath: "C:/node.exe",
  cliPath: "C:/project/Noutify/dist/cli.js",
};

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noutify-memory-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("generic agent memory", () => {
  it("parses an explicit generic agent and project-relative memory path", () => {
    expect(parseMemoryLink("generic:cursor=AGENTS.md")).toEqual({
      agent: "generic:cursor",
      relativePath: "AGENTS.md",
    });
  });

  it.each([
    "generic:cursor=../AGENTS.md",
    "generic:cursor=docs/../../AGENTS.md",
    "generic:cursor=C:/outside/AGENTS.md",
    "generic:cursor=\\\\server\\share\\AGENTS.md",
    "generic:cursor=",
    "codex=AGENTS.md",
    "generic:Cursor=AGENTS.md",
    "generic:cursor=AGENTS.md\u0000.txt",
    "generic:cursor=.noutify/instructions/cursor.md",
    "generic:cursor=noutify.config.json",
    "generic:cursor=.noutify.local.json",
  ])("rejects unsafe or malformed memory link %s", (value) => {
    expect(() => parseMemoryLink(value)).toThrow();
  });

  it("merges one owned reference while preserving unrelated content", async () => {
    const root = await temporaryProject();
    const path = join(root, "AGENTS.md");
    const original = "# Existing instructions\n\nKeep this byte-for-byte.";
    await writeFile(path, original, "utf8");

    await expect(
      installMemoryIntegration(
        root,
        { agent: "generic:cursor", relativePath: "AGENTS.md" },
        runtime,
      ),
    ).resolves.toEqual({ changed: true, pending: false });

    const merged = await readFile(path, "utf8");
    expect(merged.startsWith(original)).toBe(true);
    expect(merged).toContain("<!-- noutify:generic:cursor:start -->");
    expect(merged).toContain(".noutify/instructions/cursor.md");
    expect(merged).toContain("<!-- noutify:generic:cursor:end -->");
    const instruction = await readFile(
      join(root, ".noutify", "instructions", "cursor.md"),
      "utf8",
    );
    expect(instruction).toContain(
      "`node Noutify/dist/cli.js notify waiting --agent generic:cursor`",
    );
    expect(instruction).toContain("Never read or reveal `.noutify.local.json`.");
    expect(instruction).not.toContain("private_topic");
  });

  it("creates only the owned instruction and reports pending without a memory path", async () => {
    const root = await temporaryProject();

    await expect(
      installMemoryIntegration(root, { agent: "generic:cursor" }, runtime),
    ).resolves.toEqual({ changed: true, pending: true });
    await expect(
      readFile(join(root, ".noutify", "instructions", "cursor.md"), "utf8"),
    ).resolves.toContain("notify waiting --agent generic:cursor");
    await expect(access(join(root, "AGENTS.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("is byte-idempotent after the exact owned instruction and block exist", async () => {
    const root = await temporaryProject();
    const link = { agent: "generic:cursor" as const, relativePath: "AGENTS.md" };
    await installMemoryIntegration(root, link, runtime);
    const beforeMemory = await readFile(join(root, "AGENTS.md"));
    const beforeInstruction = await readFile(
      join(root, ".noutify", "instructions", "cursor.md"),
    );

    await expect(installMemoryIntegration(root, link, runtime)).resolves.toEqual({
      changed: false,
      pending: false,
    });
    await expect(readFile(join(root, "AGENTS.md"))).resolves.toEqual(beforeMemory);
    await expect(
      readFile(join(root, ".noutify", "instructions", "cursor.md")),
    ).resolves.toEqual(beforeInstruction);
  });

  it.each(["parent", "target"])(
    "rejects a symbolic link in the existing %s path segment before writing",
    async (segment) => {
      const root = await temporaryProject();
      const outside = await temporaryProject();
      const instructionPath = join(root, ".noutify", "instructions", "cursor.md");
      let relativePath: string;
      if (segment === "parent") {
        await symlink(outside, join(root, "linked"), "junction");
        relativePath = "linked/AGENTS.md";
      } else {
        await symlink(outside, join(root, "AGENTS.md"), "junction");
        relativePath = "AGENTS.md";
      }

      await expect(
        installMemoryIntegration(
          root,
          { agent: "generic:cursor", relativePath },
          runtime,
        ),
      ).rejects.toThrow(/symbolic link/);
      await expect(access(instructionPath)).rejects.toMatchObject({ code: "ENOENT" });
      if (segment === "target") {
        await expect(access(outside)).resolves.toBeUndefined();
      }
    },
  );

  it("rejects a symlink in the owned instruction path before touching memory", async () => {
    const root = await temporaryProject();
    const outside = await temporaryProject();
    await mkdir(join(root, ".noutify"));
    await symlink(outside, join(root, ".noutify", "instructions"), "junction");
    await writeFile(join(root, "AGENTS.md"), "original", "utf8");

    await expect(
      installMemoryIntegration(
        root,
        { agent: "generic:cursor", relativePath: "AGENTS.md" },
        runtime,
      ),
    ).rejects.toThrow(/symbolic link/);
    await expect(readFile(join(root, "AGENTS.md"), "utf8")).resolves.toBe(
      "original",
    );
    await expect(access(join(outside, "cursor.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    ["directory target", async (path: string) => mkdir(path), /regular file/],
    ["NUL content", async (path: string) => writeFile(path, Buffer.from("text\0tail")), /text file/],
    ["invalid UTF-8", async (path: string) => writeFile(path, Buffer.from([0xc3, 0x28])), /UTF-8/],
  ] as const)("rejects a %s before creating owned instructions", async (_label, create, message) => {
    const root = await temporaryProject();
    const path = join(root, "AGENTS.md");
    await create(path);

    await expect(
      installMemoryIntegration(
        root,
        { agent: "generic:cursor", relativePath: "AGENTS.md" },
        runtime,
      ),
    ).rejects.toThrow(message);
    await expect(
      access(join(root, ".noutify", "instructions", "cursor.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    "<!-- noutify:generic:cursor:start -->\nmodified",
    "modified\n<!-- noutify:generic:cursor:end -->",
    "<!-- noutify:generic:other:start -->\nmodified\n<!-- noutify:generic:cursor:end -->",
    "<!-- noutify:generic:cursor:start -- >\nmodified",
  ])("rejects malformed ownership markers without rewriting memory", async (original) => {
    const root = await temporaryProject();
    const path = join(root, "AGENTS.md");
    await writeFile(path, original, "utf8");

    await expect(
      installMemoryIntegration(
        root,
        { agent: "generic:cursor", relativePath: "AGENTS.md" },
        runtime,
      ),
    ).rejects.toThrow(/marker/);
    await expect(readFile(path, "utf8")).resolves.toBe(original);
    await expect(
      access(join(root, ".noutify", "instructions", "cursor.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uninstalls only exact owned content and preserves unrelated bytes", async () => {
    const root = await temporaryProject();
    const path = join(root, "docs", "AGENTS.md");
    await mkdir(dirname(path), { recursive: true });
    const original = "# Existing\nkeep me";
    await writeFile(path, original, "utf8");
    const link = {
      agent: "generic:cursor" as const,
      relativePath: "docs/AGENTS.md",
    };
    await installMemoryIntegration(root, link, runtime);

    await expect(uninstallMemoryIntegration(root, link, runtime)).resolves.toEqual({
      changed: true,
    });
    await expect(readFile(path, "utf8")).resolves.toBe(original);
    await expect(
      access(join(root, ".noutify", "instructions", "cursor.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves modified owned-looking content during uninstall", async () => {
    const root = await temporaryProject();
    const path = join(root, "AGENTS.md");
    const modified = [
      "<!-- noutify:generic:cursor:start -->",
      "user-modified body",
      "<!-- noutify:generic:cursor:end -->",
    ].join("\n");
    await writeFile(path, modified, "utf8");
    await mkdir(join(root, ".noutify", "instructions"), { recursive: true });
    await writeFile(
      join(root, ".noutify", "instructions", "cursor.md"),
      "user-modified instruction",
      "utf8",
    );

    await expect(
      uninstallMemoryIntegration(
        root,
        { agent: "generic:cursor", relativePath: "AGENTS.md" },
        runtime,
      ),
    ).resolves.toEqual({ changed: false });
    await expect(readFile(path, "utf8")).resolves.toBe(modified);
    await expect(
      readFile(join(root, ".noutify", "instructions", "cursor.md"), "utf8"),
    ).resolves.toBe("user-modified instruction");
  });
});
