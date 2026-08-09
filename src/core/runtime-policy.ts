// Two attempts plus the retry delay consume at most 8.5 seconds. Native hooks
// with a 10-second platform limit therefore retain 1.5 seconds for process
// startup, configuration reads, and their mandatory output contract.
export const NTFY_ATTEMPT_TIMEOUT_MS = 4_000;
export const NTFY_RETRY_DELAY_MS = 500;
export const CLAUDE_HOOK_TIMEOUT_MS = 12_000;
