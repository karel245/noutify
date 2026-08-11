import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { assertSafeProjectPath } from "../core/project-path.js";
import type {
  JsonHookFileSpec,
  JsonHookInspection,
  JsonHookMutation,
} from "./json-hook-file.js";

type TokenKind =
  | "{"
  | "}"
  | "["
  | "]"
  | ":"
  | ","
  | "string"
  | "number"
  | "true"
  | "false"
  | "null"
  | "eof";

interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  value?: unknown;
}

interface JsoncNodeBase {
  start: number;
  end: number;
  value: unknown;
}

interface JsoncScalarNode extends JsoncNodeBase {
  kind: "scalar";
}

interface JsoncArrayItem {
  node: JsoncNode;
  comma?: Token;
}

interface JsoncArrayNode extends JsoncNodeBase {
  kind: "array";
  closeStart: number;
  items: JsoncArrayItem[];
  value: unknown[];
}

interface JsoncProperty {
  key: string;
  keyStart: number;
  valueNode: JsoncNode;
  comma?: Token;
}

interface JsoncObjectNode extends JsoncNodeBase {
  kind: "object";
  closeStart: number;
  properties: JsoncProperty[];
  value: Record<string, unknown>;
}

type JsoncNode = JsoncScalarNode | JsoncArrayNode | JsoncObjectNode;

interface JsoncHookFile {
  exists: boolean;
  path: string;
  contents: string;
  root: JsoncObjectNode;
}

interface ArrayLocation {
  array?: JsoncArrayNode;
  missing?: {
    container: JsoncObjectNode;
    pathIndex: number;
  };
}

interface TextEdit {
  start: number;
  end: number;
  text: string;
}

class JsoncParser {
  private index = 0;
  private lookahead: Token | undefined;

  constructor(private readonly source: string) {
    if (source.startsWith("\uFEFF")) this.index = 1;
  }

  parseDocument(): JsoncNode {
    const node = this.parseValue();
    if (this.peek().kind !== "eof") this.fail();
    return node;
  }

  private parseValue(): JsoncNode {
    const token = this.peek();
    if (token.kind === "{") return this.parseObject();
    if (token.kind === "[") return this.parseArray();
    if (
      token.kind === "string" ||
      token.kind === "number" ||
      token.kind === "true" ||
      token.kind === "false" ||
      token.kind === "null"
    ) {
      this.take();
      return {
        kind: "scalar",
        start: token.start,
        end: token.end,
        value: token.value,
      };
    }
    return this.fail();
  }

  private parseObject(): JsoncObjectNode {
    const open = this.expect("{");
    const properties: JsoncProperty[] = [];
    const value = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();

    if (this.peek().kind === "}") {
      const close = this.take();
      return {
        kind: "object",
        start: open.start,
        end: close.end,
        closeStart: close.start,
        properties,
        value,
      };
    }

    while (true) {
      const keyToken = this.expect("string");
      const key = keyToken.value;
      if (typeof key !== "string" || keys.has(key)) this.fail();
      keys.add(key);
      this.expect(":");
      const valueNode = this.parseValue();
      const property: JsoncProperty = {
        key,
        keyStart: keyToken.start,
        valueNode,
      };
      value[key] = valueNode.value;

      if (this.peek().kind === ",") {
        property.comma = this.take();
        properties.push(property);
        if (this.peek().kind === "}") {
          const close = this.take();
          return {
            kind: "object",
            start: open.start,
            end: close.end,
            closeStart: close.start,
            properties,
            value,
          };
        }
        continue;
      }

      properties.push(property);
      const close = this.expect("}");
      return {
        kind: "object",
        start: open.start,
        end: close.end,
        closeStart: close.start,
        properties,
        value,
      };
    }
  }

  private parseArray(): JsoncArrayNode {
    const open = this.expect("[");
    const items: JsoncArrayItem[] = [];
    const value: unknown[] = [];

    if (this.peek().kind === "]") {
      const close = this.take();
      return {
        kind: "array",
        start: open.start,
        end: close.end,
        closeStart: close.start,
        items,
        value,
      };
    }

    while (true) {
      const node = this.parseValue();
      const item: JsoncArrayItem = { node };
      value.push(node.value);
      if (this.peek().kind === ",") {
        item.comma = this.take();
        items.push(item);
        if (this.peek().kind === "]") {
          const close = this.take();
          return {
            kind: "array",
            start: open.start,
            end: close.end,
            closeStart: close.start,
            items,
            value,
          };
        }
        continue;
      }

      items.push(item);
      const close = this.expect("]");
      return {
        kind: "array",
        start: open.start,
        end: close.end,
        closeStart: close.start,
        items,
        value,
      };
    }
  }

  private peek(): Token {
    this.lookahead ??= this.readToken();
    return this.lookahead;
  }

  private take(): Token {
    const token = this.peek();
    this.lookahead = undefined;
    return token;
  }

  private expect(kind: TokenKind): Token {
    const token = this.take();
    if (token.kind !== kind) this.fail();
    return token;
  }

  private readToken(): Token {
    this.skipTrivia();
    const start = this.index;
    if (start >= this.source.length) {
      return { kind: "eof", start, end: start };
    }

    const character = this.source[start] as string;
    if ("{}[]:,".includes(character)) {
      this.index += 1;
      return {
        kind: character as Extract<TokenKind, "{" | "}" | "[" | "]" | ":" | ",">,
        start,
        end: this.index,
      };
    }
    if (character === '"') return this.readString();

    for (const [literal, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (this.source.startsWith(literal, start)) {
        this.index += literal.length;
        return {
          kind: literal as "true" | "false" | "null",
          start,
          end: this.index,
          value,
        };
      }
    }

    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.source.slice(start),
    )?.[0];
    if (number !== undefined) {
      this.index += number.length;
      return {
        kind: "number",
        start,
        end: this.index,
        value: JSON.parse(number) as unknown,
      };
    }

    return this.fail();
  }

  private readString(): Token {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index] as string;
      if (character === '"') {
        this.index += 1;
        const raw = this.source.slice(start, this.index);
        return {
          kind: "string",
          start,
          end: this.index,
          value: JSON.parse(raw) as unknown,
        };
      }
      if (character.charCodeAt(0) <= 0x1f) this.fail();
      if (character !== "\\") {
        this.index += 1;
        continue;
      }

      this.index += 1;
      const escaped = this.source[this.index];
      if (escaped === undefined) this.fail();
      if ('"\\/bfnrt'.includes(escaped)) {
        this.index += 1;
        continue;
      }
      if (escaped !== "u") this.fail();
      const codePoint = this.source.slice(this.index + 1, this.index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(codePoint)) this.fail();
      this.index += 5;
    }
    return this.fail();
  }

  private skipTrivia(): void {
    while (this.index < this.source.length) {
      const character = this.source[this.index] as string;
      if (character === " " || character === "\t" || character === "\r" || character === "\n") {
        this.index += 1;
        continue;
      }
      if (character !== "/") return;

      const next = this.source[this.index + 1];
      if (next === "/") {
        this.index += 2;
        while (
          this.index < this.source.length &&
          this.source[this.index] !== "\r" &&
          this.source[this.index] !== "\n"
        ) {
          this.index += 1;
        }
        continue;
      }
      if (next !== "*") return;

      const close = this.source.indexOf("*/", this.index + 2);
      if (close < 0) this.fail();
      this.index = close + 2;
    }
  }

  private fail(): never {
    throw new Error("invalid JSONC");
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function labelFor(spec: JsonHookFileSpec<unknown>): string {
  return spec.errorLabel ?? "JSONC hook file";
}

function arrayPathLabel(spec: JsonHookFileSpec<unknown>): string {
  return `${labelFor(spec)} ${spec.arrayPath.join(".")}`;
}

function requireArrayPath(spec: JsonHookFileSpec<unknown>): void {
  if (spec.arrayPath.length === 0) {
    throw new Error("JSONC hook array path must not be empty");
  }
}

function parseRoot(contents: string, label: string): JsoncObjectNode {
  let node: JsoncNode;
  try {
    node = new JsoncParser(contents).parseDocument();
  } catch {
    throw new Error(`${label} contains invalid JSONC`);
  }
  if (node.kind !== "object") throw new Error(`${label} must be an object`);
  return node;
}

async function readJsoncHookFile<T>(
  projectRoot: string,
  spec: JsonHookFileSpec<T>,
): Promise<JsoncHookFile> {
  requireArrayPath(spec);
  const path = join(projectRoot, spec.relativePath);
  await assertSafeProjectPath(projectRoot, path);
  let contents: string;
  let exists = true;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    exists = false;
    contents = "{\n}\n";
  }
  return {
    exists,
    path,
    contents,
    root: parseRoot(contents, labelFor(spec)),
  };
}

function property(
  object: JsoncObjectNode,
  key: string,
): JsoncProperty | undefined {
  return object.properties.find((entry) => entry.key === key);
}

function locateArray<T>(
  root: JsoncObjectNode,
  spec: JsonHookFileSpec<T>,
): ArrayLocation {
  let container = root;
  for (let index = 0; index < spec.arrayPath.length; index += 1) {
    const key = spec.arrayPath[index] as string;
    const entry = property(container, key);
    if (entry === undefined) {
      return { missing: { container, pathIndex: index } };
    }
    if (index === spec.arrayPath.length - 1) {
      if (entry.valueNode.kind !== "array") {
        throw new Error(`${arrayPathLabel(spec)} must be an array`);
      }
      return { array: entry.valueNode };
    }
    if (entry.valueNode.kind !== "object") {
      throw new Error(
        `${labelFor(spec)} ${spec.arrayPath.slice(0, index + 1).join(".")} must be an object`,
      );
    }
    container = entry.valueNode;
  }
  throw new Error("JSONC hook array path is unavailable");
}

function lineStart(source: string, position: number): number {
  return source.lastIndexOf("\n", position - 1) + 1;
}

function indentationAt(source: string, position: number): string | undefined {
  const prefix = source.slice(lineStart(source, position), position);
  return /^[\t ]*$/.test(prefix) ? prefix : undefined;
}

function newlineFor(source: string): "\r\n" | "\n" {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function indentationUnit(source: string): string {
  const indents = new Set<string>([""]);
  for (const line of source.split(/\r?\n/)) {
    const match = /^([\t ]*)[^\t ]/.exec(line);
    if (match !== null) indents.add(match[1] ?? "");
  }
  let unit: string | undefined;
  for (const parent of indents) {
    for (const child of indents) {
      if (child.length <= parent.length || !child.startsWith(parent)) continue;
      const candidate = child.slice(parent.length);
      if (unit === undefined || candidate.length < unit.length) unit = candidate;
    }
  }
  return unit ?? "  ";
}

function insertionPoint(source: string, closeStart: number): {
  multiline: boolean;
  position: number;
} {
  const start = lineStart(source, closeStart);
  return /^[\t ]*$/.test(source.slice(start, closeStart)) && start > 0
    ? { multiline: true, position: start }
    : { multiline: false, position: closeStart };
}

function childIndent(
  source: string,
  container: JsoncObjectNode | JsoncArrayNode,
): string {
  const firstChildPosition =
    container.kind === "object"
      ? container.properties[0]?.keyStart
      : container.items[0]?.node.start;
  if (firstChildPosition !== undefined) {
    const existing = indentationAt(source, firstChildPosition);
    if (existing !== undefined) return existing;
  }
  const closing = indentationAt(source, container.closeStart) ?? "";
  return `${closing}${indentationUnit(source)}`;
}

function applyEdits(source: string, edits: readonly TextEdit[]): string {
  const ascending = [...edits].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  for (let index = 1; index < ascending.length; index += 1) {
    const previous = ascending[index - 1] as TextEdit;
    const current = ascending[index] as TextEdit;
    if (previous.end > current.start) {
      throw new Error("overlapping JSONC edits");
    }
  }

  let result = source;
  for (const edit of ascending.reverse()) {
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
  }
  return result;
}

function insertProperty(
  source: string,
  object: JsoncObjectNode,
  key: string,
  valueText: string,
): string {
  const edits: TextEdit[] = [];
  const last = object.properties.at(-1);
  const trailingComma = last?.comma !== undefined;
  if (last !== undefined && !trailingComma) {
    edits.push({ start: last.valueNode.end, end: last.valueNode.end, text: "," });
  }

  const point = insertionPoint(source, object.closeStart);
  const propertyText = `${JSON.stringify(key)}: ${valueText}${trailingComma ? "," : ""}`;
  edits.push({
    start: point.position,
    end: point.position,
    text: point.multiline
      ? `${childIndent(source, object)}${propertyText}${newlineFor(source)}`
      : propertyText,
  });
  return applyEdits(source, edits);
}

function insertArrayItem(
  source: string,
  array: JsoncArrayNode,
  itemText: string,
): string {
  const edits: TextEdit[] = [];
  const last = array.items.at(-1);
  const trailingComma = last?.comma !== undefined;
  if (last !== undefined && !trailingComma) {
    edits.push({ start: last.node.end, end: last.node.end, text: "," });
  }

  const point = insertionPoint(source, array.closeStart);
  const text = `${itemText}${trailingComma ? "," : ""}`;
  edits.push({
    start: point.position,
    end: point.position,
    text: point.multiline
      ? `${childIndent(source, array)}${text}${newlineFor(source)}`
      : text,
  });
  return applyEdits(source, edits);
}

function removeArrayItems(
  source: string,
  array: JsoncArrayNode,
  remove: ReadonlySet<number>,
): string {
  const survivorIndices = array.items
    .map((_item, index) => index)
    .filter((index) => !remove.has(index));
  const keepCommaStarts = new Set<number>();
  for (const index of survivorIndices.slice(0, -1)) {
    const comma = array.items[index]?.comma;
    if (comma === undefined) throw new Error("invalid JSONC array separators");
    keepCommaStarts.add(comma.start);
  }
  const hadTrailingComma = array.items.at(-1)?.comma !== undefined;
  if (hadTrailingComma && survivorIndices.length > 0) {
    const lastSurvivor = survivorIndices.at(-1) as number;
    const comma = array.items[lastSurvivor]?.comma;
    if (comma === undefined) throw new Error("invalid JSONC trailing comma");
    keepCommaStarts.add(comma.start);
  }

  const edits: TextEdit[] = [];
  for (const [index, item] of array.items.entries()) {
    if (remove.has(index)) {
      edits.push({ start: item.node.start, end: item.node.end, text: "" });
    }
    if (item.comma !== undefined && !keepCommaStarts.has(item.comma.start)) {
      edits.push({ start: item.comma.start, end: item.comma.end, text: "" });
    }
  }
  return applyEdits(source, edits);
}

function nestedArrayValue<T>(
  spec: JsonHookFileSpec<T>,
  pathIndex: number,
): string {
  let value = `[${JSON.stringify(spec.owned)}]`;
  for (let index = spec.arrayPath.length - 1; index > pathIndex; index -= 1) {
    value = `{${JSON.stringify(spec.arrayPath[index])}: ${value}}`;
  }
  return value;
}

async function writeJsoncHookFileAtomic(
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
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error;
    });
  }
}

export async function preflightJsoncHook<T>(
  projectRoot: string,
  spec: JsonHookFileSpec<T>,
): Promise<void> {
  const file = await readJsoncHookFile(projectRoot, spec);
  locateArray(file.root, spec);
}

export async function inspectJsoncHook<T>(
  projectRoot: string,
  spec: JsonHookFileSpec<T>,
): Promise<JsonHookInspection> {
  const file = await readJsoncHookFile(projectRoot, spec);
  const array = locateArray(file.root, spec).array;
  const count =
    array?.items.filter((item) => spec.isOwned(item.node.value)).length ?? 0;
  return { installed: count === 1, count };
}

export async function installJsoncHook<T>(
  projectRoot: string,
  spec: JsonHookFileSpec<T>,
): Promise<JsonHookMutation> {
  const file = await readJsoncHookFile(projectRoot, spec);
  const location = locateArray(file.root, spec);
  let next: string;

  if (location.array === undefined) {
    const missing = location.missing;
    if (missing === undefined) throw new Error("JSONC hook array path is unavailable");
    next = insertProperty(
      file.contents,
      missing.container,
      spec.arrayPath[missing.pathIndex] as string,
      nestedArrayValue(spec, missing.pathIndex),
    );
  } else {
    const ownedIndices = location.array.items
      .map((item, index) => (spec.isOwned(item.node.value) ? index : -1))
      .filter((index) => index >= 0);
    if (ownedIndices.length === 1) return { changed: false };
    next =
      ownedIndices.length === 0
        ? insertArrayItem(file.contents, location.array, JSON.stringify(spec.owned))
        : removeArrayItems(
            file.contents,
            location.array,
            new Set(ownedIndices.slice(1)),
          );
  }

  await writeJsoncHookFileAtomic(projectRoot, file.path, next);
  return { changed: true };
}

export async function uninstallJsoncHook<T>(
  projectRoot: string,
  spec: JsonHookFileSpec<T>,
): Promise<JsonHookMutation> {
  const file = await readJsoncHookFile(projectRoot, spec);
  if (!file.exists) return { changed: false };
  const array = locateArray(file.root, spec).array;
  if (array === undefined) return { changed: false };
  const ownedIndices = array.items
    .map((item, index) => (spec.isOwned(item.node.value) ? index : -1))
    .filter((index) => index >= 0);
  if (ownedIndices.length === 0) return { changed: false };

  const next = removeArrayItems(file.contents, array, new Set(ownedIndices));
  await writeJsoncHookFileAtomic(projectRoot, file.path, next);
  return { changed: true };
}
