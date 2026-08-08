# Install Noutify

Follow this state machine from the target project's root. Do not ask for paths
or read `.noutify.local.json`.

## Language

Use the latest clear user request or established conversation language. Otherwise
inspect `[System.Globalization.CultureInfo]::CurrentUICulture`. Map Spanish to
`es` and English to `en`; otherwise use English notifications. For an unsupported
interaction language, use English notifications and tell the user in the interaction
language that notifications will use English. Commands and JSON stay unchanged.

## Prepare

Run one command: `node Noutify/scripts/install.mjs --language <es|en>`. Read
only its final JSON record. For `created`, Show the new topic once in the
interaction language and tell the user in the interaction language that it is
private because it functions as the notification key. Never repeat the topic after
that display in chat, logs, summaries, commits, docs, issues, diagnostics,
artifacts, or generated files. For `existing` or any failure, use the conditional
guide below.

## Subscribe

Ask the user to subscribe their ntfy app to the displayed topic. Pause. Do not
run a test until they say the subscription is ready.

## Test and confirm

Run `node Noutify/dist/cli.js test`. Pause for the phone owner's explicit
receipt of the localized test notification. Only then run
`node Noutify/dist/cli.js confirm`, followed by `node Noutify/dist/cli.js doctor`.

## Accept

Report configuration success only when `doctor` passes after that explicit receipt.
Automatic Stop-hook phone acceptance remains pending until the owner observes a real
Stop notification. Later, `/noutify language español` or
`/noutify language english` changes notification language.

## On failure

For a failed command, `existing` record, missing topic, or collision, read
`docs/setup-troubleshooting.md`. Do not load it on the created happy path.
