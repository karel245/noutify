# Install Noutify

Follow this state machine from the target project's root. Do not ask for paths,
read `.noutify.local.json`, or repeat a topic in chat, logs, or summaries.

## Language

Detect the user's interaction language. Use `es` for Spanish and `en` for
English; speak to the user in that language. Commands and JSON stay unchanged.

## Prepare

Run one command: `node Noutify/scripts/install.mjs --language <es|en>`. Read
only its final JSON record. For `created`, Show the new topic once in the
interaction language, then never repeat it. For `existing` or any failure, use
the conditional guide below.

## Subscribe

Ask the user to subscribe their ntfy app to the displayed topic. Pause. Do not
run a test until they say the subscription is ready.

## Test and confirm

Run `node Noutify/dist/cli.js test`. Pause for the phone owner's explicit
receipt of the localized test notification. Only then run
`node Noutify/dist/cli.js confirm`, followed by `node Noutify/dist/cli.js doctor`.

## Accept

Report success only when `doctor` passes after that explicit receipt. Later,
`/noutify language español` or `/noutify language english` changes notification
language.

## On failure

For a failed command, `existing` record, missing topic, or collision, read
`docs/setup-troubleshooting.md`. Do not load it on the created happy path.
