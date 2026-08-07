import type { Notification } from "../core/types.js";
import {
  NTFY_ATTEMPT_TIMEOUT_MS,
  NTFY_RETRY_DELAY_MS,
} from "../core/runtime-policy.js";

export interface NtfyConfig {
  server: string;
  topic: string;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface NtfyDependencies {
  fetch?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
}

export type SendResult =
  | { ok: true; attempts: number }
  | {
      ok: false;
      attempts: number;
      reason: "network" | "http" | "timeout";
      status?: number;
    };

const TRANSIENT_HTTP_STATUSES = new Set([408, 429]);

function isTransientHttpStatus(status: number): boolean {
  return TRANSIENT_HTTP_STATUSES.has(status) || status >= 500;
}

function notificationUrl(config: NtfyConfig): URL {
  const server = new URL(config.server);
  if (server.protocol !== "https:" && server.protocol !== "http:") {
    throw new Error("ntfy server must use HTTP or HTTPS");
  }

  const base = server.toString().endsWith("/")
    ? server.toString()
    : `${server.toString()}/`;
  return new URL(encodeURIComponent(config.topic), base);
}

function failureReason(error: unknown): "network" | "timeout" {
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return "timeout";
  }
  return "network";
}

function isTransientThrownError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

export async function sendNtfy(
  notification: Notification,
  config: NtfyConfig,
  dependencies: NtfyDependencies = {},
): Promise<SendResult> {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const url = notificationUrl(config);

  for (let attempts = 1; attempts <= 2; attempts += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Title: notification.title,
          Tags: notification.tags.join(","),
          Priority: notification.priority,
        },
        body: notification.message,
        signal: AbortSignal.timeout(NTFY_ATTEMPT_TIMEOUT_MS),
      });

      if (response.ok) {
        return { ok: true, attempts };
      }

      if (attempts === 1 && isTransientHttpStatus(response.status)) {
        await sleep(NTFY_RETRY_DELAY_MS);
        continue;
      }

      return {
        ok: false,
        attempts,
        reason: "http",
        status: response.status,
      };
    } catch (error) {
      const reason = failureReason(error);
      if (attempts === 1 && isTransientThrownError(error)) {
        await sleep(NTFY_RETRY_DELAY_MS);
        continue;
      }
      return { ok: false, attempts, reason };
    }
  }

  return { ok: false, attempts: 2, reason: "network" };
}
