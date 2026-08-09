import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createInitialConfig,
  ensurePrivateIgnore,
  readProjectConfig,
  validateProjectConfig,
  writeProjectConfig,
} from "../../src/config/project-config.js";

const temporaryRoots: string[] = [];

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noutify-config-"));
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

describe("project configuration", () => {
  it("keeps the private topic out of the public config", async () => {
    const root = await temporaryProject();
    const bundle = createInitialConfig({
      projectName: "Demo",
      server: "https://ntfy.example",
      topic: "private_topic_1234567890",
      language: "es",
    });

    await writeProjectConfig(root, bundle);

    const publicText = await readFile(
      join(root, "noutify.config.json"),
      "utf8",
    );
    const privateText = await readFile(
      join(root, ".noutify.local.json"),
      "utf8",
    );

    expect(publicText).not.toContain("private_topic_1234567890");
    expect(JSON.parse(publicText)).toEqual({
      version: 2,
      project: { name: "Demo" },
      provider: { type: "ntfy" },
      events: { waiting: true },
      integrations: [{ agent: "claude-code", mode: "native" }],
    });
    expect(JSON.parse(privateText)).toEqual({
      server: "https://ntfy.example",
      topic: "private_topic_1234567890",
      language: "es",
      setupCompleted: false,
      automaticReceipts: {},
    });
  });

  it("normalizes a valid v1 pair to v2 without changing private values", () => {
    const v1Public = {
      version: 1,
      project: { name: " Demo " },
      provider: { type: "ntfy" },
      events: { waiting: true },
    };
    const v1Private = {
      server: "https://ntfy.example/",
      topic: "private_topic_1234567890",
      language: "es",
      setupCompleted: false,
    };

    expect(validateProjectConfig(v1Public, v1Private)).toMatchObject({
      public: {
        version: 2,
        project: v1Public.project,
        provider: v1Public.provider,
        events: v1Public.events,
        integrations: [{ agent: "claude-code", mode: "native" }],
      },
      private: { ...v1Private, automaticReceipts: {} },
    });
  });

  it("does not rewrite v1 files while reading their normalized values", async () => {
    const root = await temporaryProject();
    const publicText = `${JSON.stringify({
      version: 1,
      project: { name: "Demo" },
      provider: { type: "ntfy" },
      events: { waiting: true },
    })}\n`;
    const privateText = `${JSON.stringify({
      server: "https://ntfy.example",
      topic: "private_topic_1234567890",
      language: "es",
      setupCompleted: false,
    })}\n`;
    const publicPath = join(root, "noutify.config.json");
    const privatePath = join(root, ".noutify.local.json");

    await writeFile(publicPath, publicText, "utf8");
    await writeFile(privatePath, privateText, "utf8");

    await expect(readProjectConfig(root)).resolves.toMatchObject({
      public: { version: 2 },
      private: { automaticReceipts: {} },
    });
    await expect(readFile(publicPath, "utf8")).resolves.toBe(publicText);
    await expect(readFile(privatePath, "utf8")).resolves.toBe(privateText);
  });

  it("uses a friendly topic when none is supplied", () => {
    const bundle = createInitialConfig({ projectName: "Demo" });

    expect(bundle.private.topic).toMatch(
      /^Noutify-[23456789abcdefghjkmnpqrstuvwxyz]{12}$/,
    );
  });

  it("reads legacy private configs without language as English", async () => {
    const root = await temporaryProject();
    await writeFile(
      join(root, "noutify.config.json"),
      `${JSON.stringify({
        version: 1,
        project: { name: "Demo" },
        provider: { type: "ntfy" },
        events: { waiting: true },
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(root, ".noutify.local.json"),
      `${JSON.stringify({
        server: "https://ntfy.sh",
        topic: "private_topic_1234567890",
        setupCompleted: false,
      })}\n`,
      "utf8",
    );

    await expect(readProjectConfig(root)).resolves.toMatchObject({
      private: { language: "en" },
    });
  });

  it("adds the private config to gitignore exactly once", async () => {
    const root = await temporaryProject();
    await writeFile(join(root, ".gitignore"), "dist/\n", "utf8");

    await ensurePrivateIgnore(root);
    await ensurePrivateIgnore(root);

    const lines = (await readFile(join(root, ".gitignore"), "utf8"))
      .split(/\r?\n/)
      .filter((line) => line === ".noutify.local.json");
    expect(lines).toEqual([".noutify.local.json"]);
  });

  it("rejects a short or unsafe topic before writing files", async () => {
    expect(() =>
      createInitialConfig({
        projectName: "Demo",
        topic: "short/topic",
      }),
    ).toThrow("topic must contain 16 to 128 URL-safe characters");
  });

  it("round-trips a valid config across repeated writes", async () => {
    const root = await temporaryProject();
    const bundle = createInitialConfig({ projectName: "Demo" });

    await writeProjectConfig(root, bundle);
    await writeProjectConfig(root, bundle);

    await expect(readProjectConfig(root)).resolves.toEqual(bundle);
  });

  it("rejects malformed persisted configuration", async () => {
    const root = await temporaryProject();
    await writeFile(join(root, "noutify.config.json"), "{}\n", "utf8");
    await writeFile(join(root, ".noutify.local.json"), "{}\n", "utf8");

    await expect(readProjectConfig(root)).rejects.toThrow(
      "public config version must be 1 or 2",
    );
  });

  it("rejects private fields persisted in the public config", async () => {
    const root = await temporaryProject();
    const bundle = createInitialConfig({
      projectName: "Demo",
      topic: "private_topic_1234567890",
    });
    await writeProjectConfig(root, bundle);
    const publicPath = join(root, "noutify.config.json");
    const publicValue = JSON.parse(
      await readFile(publicPath, "utf8"),
    ) as Record<string, unknown>;
    publicValue.topic = "private_topic_1234567890";
    await writeFile(publicPath, `${JSON.stringify(publicValue)}\n`, "utf8");

    await expect(readProjectConfig(root)).rejects.toThrow(
      "public config contains unexpected field: topic",
    );
  });

  it("rolls back public and ignore files when a private write fails", async () => {
    const root = await temporaryProject();
    await writeFile(join(root, ".gitignore"), "dist/\n", "utf8");
    await mkdir(join(root, ".noutify.local.json"));
    const bundle = createInitialConfig({ projectName: "Demo" });

    await expect(writeProjectConfig(root, bundle)).rejects.toBeDefined();

    await expect(readFile(join(root, ".gitignore"), "utf8")).resolves.toBe(
      "dist/\n",
    );
    await expect(
      readFile(join(root, "noutify.config.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
