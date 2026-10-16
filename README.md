# OdysseyAtAMC

A small, stateful monitor for **bookable IMAX 70mm screenings at AMC Lincoln Square 13** in New York. It checks AMC's official showtime API and sends direct booking links through Telegram, or emits a simple output contract for another notification runner.

## Why it exists

Finding a movie listed as “IMAX” is not enough when the intended experience is IMAX 70mm film. The monitor separates that exact format from digital IMAX, IMAX with Laser, standard 70mm, and Dolby Cinema, then tracks availability changes so routine checks do not repeat the same alert.

The original design targeted *The Odyssey* with a local notification runner. The implementation now supports a configurable movie list and a GitHub Actions runner that can run independently of a personal computer. This is the initial public source release following private development; internal work notes, deployment credentials and operational state are not included.

## Behavior and design choices

- Movie names and aliases live in [`src/Titles.ts`](src/Titles.ts). Matching normalizes punctuation, case and trailing articles, and permits additional event text. Partial title matching can also match unintended longer titles.
- Only an explicit IMAX 70mm format label qualifies. The API client verifies the theatre's ID, name and slug and accepts booking URLs only over HTTPS on AMC domains.
- The first successful check records a **silent baseline**. Later checks notify when a new screening is bookable or a known unavailable screening becomes bookable. An unavailable-to-bookable transition can include reopened availability; this is not an individual-seat tracker.
- Failed checks preserve known screenings. After three consecutive failures, one maintenance warning is emitted for that failure episode; a successful check resets the failure counter.
- New-screening Telegram alerts are loud. Maintenance warnings and daily status messages are silent. Telegram messages use plain text and split at screening boundaries.
- Cloud delivery happens before successor state is saved. This favors retrying a missed delivery, with possible duplicates after partial delivery or persistence failures.

## Architecture

| Area | Responsibility |
| --- | --- |
| `src/amc/api.ts` | Validated AMC API requests, bounded retries, pagination and exact-format filtering |
| `src/amc/client.ts` | Environment loading and fetch-result boundary |
| `src/detect.ts` | Pure state transitions, baseline, availability changes and failure episodes |
| `src/state/store.ts` | Schema-validated JSON state with temporary-file replacement |
| `src/run.ts`, `src/cli.ts` | Local runner and marker-based stdout |
| `src/cloud/run.ts`, `src/cloud-cli.ts` | Telegram delivery, state ordering, daily status and smoke-test modes |
| `src/cloud/telegram.ts` | Bounded Telegram requests, response checks and message splitting |
| `.github/workflows/monitor.yml` | Manual cloud execution, concurrency and state cache |
| `src/amc/extract.ts`, `src/amc/classify.ts` | Legacy rendered-page extraction, retained for diagnostics and tests |

TypeScript runs through `tsx`; Zod validates external data and persisted state. Vitest covers API parsing, classification, state transitions, delivery and CLI behavior. Playwright supports browser extraction tests and the legacy inspector; the production API runner does not require a browser.

## Local setup

Use **Node.js 22 or newer** and npm:

```sh
npm ci
```

Supply your own AMC developer credential through `AMC_API_KEY`, or copy `.env.example` to an untracked `.env.local` and fill in the value locally. The local API client loads `.env.local` when the environment variable is absent. Credentials and Telegram chat identifiers belong in private environment configuration, never in tracked files or logs.

Edit `TRACKED_MOVIES` in `src/Titles.ts` to choose films and aliases. The theatre and Eastern timezone are currently fixed in code. `MONITOR_STATE_PATH` optionally overrides the default `var/state.json`.

Run once to establish the baseline:

```sh
npm run --silent monitor
```

The local CLI prints `MONITOR_OK` on a successful first run. Subsequent stdout starts with one of these markers:

| Marker | Meaning |
| --- | --- |
| `MONITOR_OK` | No notification, initial baseline, recovery, or failure below the warning threshold |
| `MONITOR_NOTIFY` | New bookable screening details follow the marker |
| `MONITOR_WARNING` | Maintenance warning or runtime error details follow the marker |

A notification runner must interpret the marker and deliver the following text; the local CLI itself does not send Telegram messages. Uncaught local runtime failures set a nonzero exit code. Ordinary AMC failure counts remain persisted state-machine outcomes.

## GitHub Actions and Telegram

1. Create a Telegram bot through [BotFather](https://t.me/BotFather), then send `/start` in a private conversation with that bot.
2. Obtain that conversation's chat ID through Telegram's Bot API using a private authenticated request. Keep the bot token, chat ID and response private.
3. Add these repository Actions secrets: `AMC_API_KEY`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID`.
4. Run **Monitor AMC IMAX 70mm** manually from Actions to establish a baseline. For an intentional delivery test, enable `telegram_test_only`; it sends one test message without querying AMC or reading/writing monitor state. `daily_status_test_only` tests the silent daily message similarly.

The public workflow is **manual-only**. It does not run a schedule or share credentials/state with the privately operated monitor. The original deployment cadence was every five minutes from 7:02 a.m. to 9:57 p.m. Eastern, with a 10:02 p.m. state-only daily status. The daily-status mode sends a silent message when initialized state has no new-screening alert or prior status for that Eastern date. To deploy your own schedule, configure it deliberately with your own account allowance and credentials; GitHub schedules are best effort.

For a local cloud-mode run, export all three variables into the process environment and run `npm run --silent monitor:cloud`. Cloud configuration requires `AMC_API_KEY` in the environment; a file-only local key is not sufficient for that entry point. A delivered maintenance warning exits successfully so its state can be saved; uncaught configuration, storage or delivery failures exit nonzero.

## State and recovery

Local state is `var/state.json`. The cloud workflow restores and saves that path through Actions cache and serializes jobs through a concurrency group. Cache is **not durable storage**. Cache eviction or loss produces a new silent baseline and may miss alerts for screenings already present at that moment.

To deliberately reset a local baseline, back up the state file privately, then remove the original. The next successful check creates a silent baseline. Do not delete state as a routine troubleshooting step.

Delivery is **at least once**: an early Telegram chunk can be repeated if a later chunk fails, and a complete message can be repeated if state saving subsequently fails. There is no durable per-message delivery ledger. Concurrent local processes sharing one state path are not coordinated.

## Verification and diagnostics

Install Chromium before running the full suite, because it includes browser-backed extraction tests:

```sh
npx playwright install chromium
npm run build
npm test
npm run test:integration
```

`build` performs TypeScript checking without emitting files. `npm run test:cloud` is a browser-free subset for cloud runner and delivery behavior. The legacy browser inspector also requires Chromium.

`npm run inspect:amc-api` makes live read-only AMC requests and reports theatre identity, date range and matches without changing state. `npm run inspect:amc` inspects the rendered page and can time out while the site continues loading. Both require external service access; tests primarily use saved fixtures and fake requests rather than live credentials.

## Limitations and deployment boundaries

- This is a single-theatre availability monitor, not a ticket purchaser, seat reservation system or guarantee of timely alerts. It depends on AMC account access, API accuracy and continued schema compatibility.
- Each API run scans today plus 180 days with four concurrent date workers. Before pagination or retries, that is 181 showtime requests plus one theatre request. At the original cadence of 180 checks per day, that is approximately **32,760 API requests daily**. Confirm the vendor account's allowance before deployment.
- Empty aggregate data and invalid schemas fail closed; an API outage or a legitimately empty dataset can therefore produce maintenance warnings.
- State can contain screening URLs and stored failure messages. Treat local state and cloud cache as operational data and do not store credentials in diagnostic text. Error normalization is not a general-purpose secret scrubber.
- Workflow dependencies use version tags, and dependency advisories require ongoing review. Test infrastructure and browser diagnostics should run in a trusted development environment.
- No license file is included. This README does not grant an additional license.
