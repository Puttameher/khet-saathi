# Khet Saathi · खेत साथी

**A voice-first crop companion: a farmer tells it their plans in Hindi, and it checks the weather for them and says when to go, wait or skip.**

Built for Gnani AI's *Great Indian AI Internship Challenge* (2026). Voice in is Gnani **Prisma** (STT) and voice out is Gnani **Timbre** (TTS).

---

## The problem

A spray done just before rain is wasted money, and spraying in strong wind or midday heat is unsafe and doesn't work well. Most small farmers already have a forecast app on their phone. What it doesn't give them is the next step: *"I planned to spray the day after tomorrow. Is that still OK?"* Forecast apps are mostly text, in English, and don't know what the farmer has planned.

## Who it's for

Small and marginal farmers in India who:
- are more comfortable speaking than reading or typing (Hindi / Hinglish first, Telugu supported),
- use a basic Android phone, often outdoors in bright sun,
- plan field work (spray, irrigation, fertiliser, harvest) a few days ahead.

## What it does (built)

| | Feature | How |
|---|---|---|
| 🎙️ | **Voice onboarding** | Asks for crop (wheat / rice / onion), sowing or harvest date, land size, village, and irrigation. Reads the profile back and takes corrections by voice. The village is geocoded with Open-Meteo. |
| 📝 | **Voice task memory** | *"parson spray karna hai"* becomes a spray task on the date "parson" means in IST. Supported types: spray, irrigate, fertilize, harvest, other. Tasks persist in SQLite. |
| 🌦️ | **"It watches for me" monitor** | Runs at 06:00, 12:00 and 18:00 IST plus on demand. Each active task gets a **deterministic** rules verdict, **GO / WAIT / SKIP_TODAY** (or **UNKNOWN** if there's no data), with reasons, thresholds and a better window when one exists. When a verdict turns bad, a deduplicated alert is raised. |
| 🗣️ | **Daily briefing + voice replies** | On open, a short spoken Timbre briefing covers the weather and the status of each task. The farmer answers by voice: *"theek hai"* keeps the task, *"kal kar dunga"* reschedules it, *"spray ho gaya"* marks it done. |
| ❓ | **Grounded Q&A** | *"kal spray kar sakta hoon?"* is answered from the profile, tasks, forecast and rules output. If the data is missing, it says so instead of guessing. |
| 🌾 | **Khet tab** | An animated field scene driven by real weather: sun/moon position, sky, cloud, rain, wind sway, soil moisture and crop stage. The **Crop Care Score** orb can be tapped to show what makes up the score. |
| ✅ | **Kaam tab** | Task cards showing the verdict chip, reasons, thresholds, data source and timestamp, with start / done / postpone / reschedule. Updates show immediately, and finishing a task plays a celebration. |
| 💬 | **Baat tab** | A large mic button with a live waveform. Audio is recorded as 16 kHz WAV and sent to Prisma; the reply plays through Timbre (streamed). There's a text fallback and example chips. |
| 🎬 | **DEMO_MODE** | Off by default. When on, it lays a scripted clear→storm scenario over the **real** forecast so a storm can be shown on cue in the video. Whenever it's active the UI shows a **DEMO** badge and the advisory source reads `demo`. |

**In progress (not finished at the time of writing):**
- 48-hour forecast time scrubber on the Khet scene
- Medicine/pesticide label reading from a photo (vision LLM, label text only)

**Not built:** mandi price comparison, offline PWA shell, 8 kHz phone-audio mode.

## Setup

Requires Node ≥ 22.

```bash
git clone <repo-url> khet-saathi && cd khet-saathi
npm install
cp .env.example .env          # add GNANI_API_KEY and LLM_API_KEY
npm run smoke:gnani           # optional: one real Prisma + Timbre round trip
npm run dev                   # http://localhost:3000
```

The SQLite database (`data/khet-saathi.db`) and its tables are created on first run. The scheduler starts in-process through `instrumentation.ts`.

### Environment variables (`.env.example`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GNANI_API_KEY` | ✅ | – | One Gnani key with **both STT and TTS scopes**. Used only on the server and never logged. (`GNANI_STT_API_KEY` / `GNANI_TTS_API_KEY` override it per service if your keys are split.) |
| `GNANI_BASE_URL` | | `https://api.vachana.ai` | Gnani API base |
| `GNANI_STT_MODEL` | | `prisma-v3.0` | Prisma model (`prisma-v2.5` also works) |
| `GNANI_TTS_MODEL` | | `timbre-v3.0` | Timbre model (`timbre-v2.5` also works) |
| `LLM_API_KEY` | ✅* | – | Key for any OpenAI-compatible endpoint (Groq by default) |
| `LLM_BASE_URL` | | `https://api.groq.com/openai/v1` | LLM endpoint |
| `LLM_MODEL` | | see `.env.example` | Model used for intent and profile extraction |
| `MONITOR_TIMES` | | `06:00,12:00,18:00` | Monitor slots (IST) |
| `SCHEDULER_ENABLED` | | `1` | Set `0` for serverless deploys and trigger `POST /api/monitor` externally |
| `KS_DB_PATH` | | `./data/khet-saathi.db` | SQLite file |
| `DEMO_MODE` | | `0` | `1` enables the badged storm/clear demo overlay (`POST /api/demo`) |

\*Without an LLM key the app still runs on the rule-based intent parser. Free-form phrasing and grounded explanations get weaker.

## Which Gnani APIs are used and where

| Gnani API | Endpoint | File | Purpose |
|---|---|---|---|
| **Prisma STT** (REST) | `POST /stt/v3` (multipart, `language_code` `hi-IN,en-IN` / `te-IN,en-IN`, `format=codemix`) | `lib/gnani.ts` → `gnaniStt` | Turns the farmer's speech into text |
| | | `app/api/voice/route.ts` | Voice turn: WAV upload → Prisma → conversation logic → reply text |
| **Timbre TTS** (SSE stream) | `POST /api/v1/tts/sse` | `lib/gnani.ts` → `gnaniTtsStream`, `app/api/tts/route.ts` | Streams replies, briefings and alerts so playback starts on the first chunk |
| **Timbre TTS** (REST) | `POST /api/v1/tts/inference` | `lib/gnani.ts` → `gnaniTts` | Fallback when streaming fails. Results are cached on disk by (model, voice, language, speed, text) |
| Both | – | `scripts/smoke-gnani.ts` | TTS a farmer sentence, then STT that audio back (round-trip check) |

Auth uses the `X-API-Key-ID` header. All calls go through the backend: there are per-service request queues, retries with backoff on 429/5xx, timeouts, and zod-validated responses. Language and voice settings are in `config/app.json`.

## Architecture in brief

```
mic → /api/voice → Prisma STT → NLU (rules first, LLM fallback) → conversation
    → rules engine + task FSM (deterministic) → reply text → /api/tts → Timbre → speaker
node-cron 06/12/18 IST → monitor → Open-Meteo → rules engine → task FSM → deduped alerts
```

- **Next.js 15 (App Router) + TypeScript + Tailwind v4**, SQLite via **better-sqlite3 + Drizzle**, **node-cron**, **zod** at every boundary.
- **Weather:** Open-Meteo forecast and geocoding (no key), cached with a timestamp. If it fails, the app serves the cached data marked stale and never makes up values.
- **The LLM's role is limited.** It maps utterances to intents and slots and phrases explanations. It does **not** compute dates (it returns the spoken phrase, which `lib/time.ts` resolves in IST) and never produces weather verdicts.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the voice-turn flow, monitor flow, data model and diagram.

### Code map

| Path | What |
|---|---|
| `lib/rules.ts` + `config/spray-rules.json` | Deterministic GO/WAIT/SKIP_TODAY/UNKNOWN engine (no LLM) |
| `lib/tasks.ts` | Task state machine |
| `lib/health.ts` | Crop Care Score formula (documented in the file header) |
| `lib/nlu-rules.ts`, `lib/nlu.ts`, `lib/llm.ts` | Rule-based intent parser → LLM fallback (OpenAI-compatible, zod-validated JSON) |
| `lib/conversation.ts`, `lib/speech.ts` | Utterance → action → spoken reply (Hindi + Telugu sentence builders) |
| `lib/onboarding.ts` | Voice onboarding state machine |
| `lib/monitor.ts`, `lib/scheduler.ts` | Monitor job and idempotent IST scheduler |
| `lib/weather.ts`, `lib/demo.ts` | Open-Meteo client and cache; DEMO_MODE overlay |
| `app/api/*` | `voice`, `turn`, `tts`, `briefing`, `state`, `tasks`, `tasks/[id]`, `alerts`, `monitor`, `profile`, `log`, `demo`, `reset` |
| `components/{khet,kaam,baat,shell}` | The three tabs plus the app shell |
| `config/crops.json` | Growth-stage tables for wheat, rice and onion (**placeholders, flagged "verify with ICAR/KVK"**) |

## Testing

```bash
npm test            # vitest unit + flow tests
npm run typecheck
```

At the time of writing there are 105 passing tests across 10 files. They cover the rules engine, task FSM, health score, IST date parsing, rule-based NLU, the scene model, WAV encoding, geocoding, message ordering, and **`tests/flow.test.ts`**, which runs the end-to-end definition-of-done flow: plan a spray → monitor flags rain → briefing → reschedule → done → score goes up. It goes through the real conversation, monitor, FSM and DB code with only Open-Meteo mocked. `npm run smoke:gnani` checks the live Gnani APIs.

## Known limitations

- **Single farmer per instance.** There are no accounts or auth; it's a hackathon demo.
- **Three crops only** (wheat, rice, onion). Stage durations are placeholders, not agronomy advice.
- **Spray thresholds** are conservative general defaults. They haven't been calibrated per crop or chemical.
- **No recorded-audio e2e test yet.** The flow test runs on text. The `test:live` script points to a `tests/e2e` folder that doesn't exist yet.
- **No Advanced settings screen yet.** Thresholds appear inside each verdict, but they can only be edited in `config/spray-rules.json`.
- Gnani accounts can be limited to one concurrent request, so STT and TTS calls are queued one at a time. A cold TTS miss adds latency; repeated phrases come from the cache.
- In-process scheduler: on serverless hosts, set `SCHEDULER_ENABLED=0` and call `POST /api/monitor` from an external cron.
- Time scrubber and label reading are still in progress (see above).

## Safety notes

- **No dose recommendations, ever.** The app never computes or suggests a pesticide or fertiliser dose and never recommends a product. The label-reading feature (in progress) is designed to repeat only what is printed on the packet, after the farmer confirms it, and to send them to the label or their local Krishi Vigyan Kendra when the text is unclear.
- **Every advisory shows its data source and timestamp** (Open-Meteo plus fetch time, or `demo` in Demo Mode), along with the exact threshold each reason crossed.
- **The weather verdicts come from deterministic rules, not an LLM.** When there's no forecast for the day, the verdict is `UNKNOWN`. It isn't guessed.
- **The Crop Care Score is not a yield or disease claim.** It's a 0–100 score based on the farmer's own inputs and the weather (tasks on time, overdue tasks, recent irrigation/spray, heat/dry/waterlogging stress, check-ins), and the UI labels it that way.
- **DEMO_MODE is always visible.** It never runs unless `DEMO_MODE=1`, and it never rewrites past weather.
- API keys stay on the server. There's per-route rate limiting and size limits on audio and text input, and no PII in logs.

## Team

| Member | Contribution |
|---|---|
| Putta Meher Prakash | _[contribution: e.g. product, architecture, full-stack build, voice UX, demo]_ |
| _[name]_ | _[contribution]_ |

## License

_[License: TBD, e.g. MIT]_
