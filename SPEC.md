# ROLE
You are a elite team in one: principal full-stack engineer, applied AI/ML engineer, senior motion designer (SVG/Canvas/GSAP-grade polish), and product designer who has shipped for low-literacy, voice-first, mobile-first users in rural India. You have 4 days of build time and one non-negotiable goal: a working app so satisfying and genuinely useful that a farmer would open it every day, and a judge would remember the 60-second demo.

# PRODUCT: "Khet Saathi" – a voice-first crop companion for farmers
The farmer talks to it in Hindi/Hinglish (and one more Indian language where Gnani supports both STT and TTS). It learns the farmer's crop, remembers plans ("I'll spray day after tomorrow"), watches the weather for them, tells them when to go, skip or wait, and shows their field as a living animated scene.

This is a hackathon entry (Gnani AI "Great Indian AI Internship Challenge"). Hard rules:
- Must GENUINELY use Gnani Prisma (STT) and Timbre (TTS). Voice is the primary interface, not a gimmick. Evon (Gnani's LLM, open weights on Hugging Face) is optional stretch only; do not burn time on GPU hosting.
- Must be a real working app with a public demo video. No fake or hardcoded behavior in the main path. A clearly labeled "Demo Mode" that overrides weather is allowed ONLY for showing storms on cue, and must be visibly marked.
- Product value lives in the logic between speech-in and speech-out. Do NOT build a thin wrapper around Gnani's APIs.

# GNANI API FACTS (verify against https://docs.gnani.ai before coding; model names and endpoints change)
- Base: https://api.vachana.ai. Auth header: `X-API-Key-ID: <key>`. Key lives in server env `GNANI_API_KEY`; NEVER expose it to the browser. All Gnani calls go through our backend.
- STT REST: `POST /stt/v3` (multipart: audio_file, language_code e.g. hi-IN, optional model prisma-v2.5 default / prisma-v3.0, format=transcribe). Realtime: `wss://api.vachana.ai/stt/v3/stream` (raw PCM, 16000 or 8000 Hz). Prisma v3.0 supports `indic-auto`.
- TTS REST: `POST /api/v1/tts/inference` (JSON: text, voice, model, language, speed, audio_config). Also SSE `/api/v1/tts/sse` and WebSocket `wss://api.vachana.ai/api/v1/tts`. Timbre is beta: add retries, fallbacks, and an audio cache keyed by (text, voice, language).
- First step: write `scripts/smoke-gnani.ts` proving one STT and one TTS call work, and list which languages BOTH support. Pick languages from the overlap only.

# STACK (keep it boring and fast)
Next.js (App Router) + TypeScript + Tailwind, mobile-first PWA. SQLite via Drizzle or Prisma ORM (single file DB, zero setup). Server-side cron via a lightweight scheduler (node-cron or a Next route triggered by an in-process interval) for monitoring. Open-Meteo for weather (free, no key). Animation: SVG + CSS + requestAnimationFrame (GSAP allowed); Canvas for particles. Any strong LLM via env-configured provider for extraction, label reading and explanations, behind a single `llm.ts` interface with strict JSON-schema outputs and validation (zod).

# FEATURES, BY PRIORITY (finish each tier fully before starting the next)

## P0 – must work flawlessly
1. **Voice onboarding**: Timbre asks short questions (crop, sowing date or expected harvest time, land size, village/district, irrigation). Farmer answers by voice (Prisma). LLM extracts a validated CropProfile; Timbre reads it back for confirmation; farmer can correct by voice. Geocode district via Open-Meteo geocoding. Support 3 crops max (wheat, rice, onion) with growth-stage tables in `config/crops.json` (durations are placeholders flagged "verify with ICAR/KVK" in the file).
2. **Voice task memory**: the farmer says things like "parson spray karna hai" / "kal paani dena hai". Parse to a Task {type: spray|irrigate|fertilize|harvest|other, plannedDate (resolve relative dates in Asia/Kolkata), notes, status}. Status machine: planned → go_ahead | skip_suggested → in_progress → done | postponed | cancelled. Always confirm by voice and show on a task card. Persist across sessions.
3. **Weather monitoring (the "it watches for me" feature)**: server job runs 3x/day (06:00, 12:00, 18:00 IST, configurable) plus on-demand refresh. For each active task, evaluate the spray rules engine over the task window. DETERMINISTIC rules, no LLM, in `config/spray-rules.json` (configurable defaults, e.g. rain probability/amount in next ~6h, wind above ~15 km/h, extreme heat midday, high humidity fungal-risk flag). Output: GO / WAIT / SKIP_TODAY with machine-readable reasons and a suggested better window. If a planned task's verdict changes to WAIT/SKIP, create an Alert and speak it via Timbre on next app open (and show a banner). Dedupe alerts; never spam.
4. **Daily check-in conversation**: when the farmer opens the app, a Timbre briefing (≤20s): weather today/tomorrow, status of each task ("Spray parson ke liye ab tak mausam theek hai, go ahead"), anything that changed. Farmer replies by voice: "theek hai" keeps it, "kal kar dunga" reschedules, "spray ho gaya" marks done. The LLM only maps utterances to intents and explains rules-engine results; it never invents weather verdicts.
5. **"Finished spraying" completion**: voice or tap marks the task done, timestamps it, triggers a celebration animation, and records it in the crop timeline.
6. **Core animated scene** (see Motion spec) wired to REAL weather + crop stage + task states.

## P1 – the wow layer
7. **Spray animation**: when a spray task is in_progress ("spraying now" voice/tap), the scene animates a sprayer moving across the rows with mist particles settling on leaves, leaf color gently refreshing, soft audio cue optional. On completion, rows glow subtly and the health bubble ticks up with a satisfying spring animation.
8. **Health bubble**: a floating, breathing orb (0–100 "Crop Care Score") with color and gentle pulse: green healthy, amber attention, red risk. It must be EXPLAINABLE: tapping shows contributing factors (tasks on time, recent rain/heat stress, spray done/overdue, irrigation logged, days since last check-in). Define the formula in `lib/health.ts` with unit tests, and label it "care score based on your inputs and weather", never a medical or yield claim.
9. **Time scrubber**: drag across the next 48h forecast; sky, rain, wind sway, light and spray-window strip update live (this is the demo money shot).
10. **Medicine label upload**: farmer photographs a pesticide/fertilizer packet. Use a vision-capable LLM to extract product name, active ingredient, crop-specific dose text, pre-harvest interval, safety warnings, strictly as printed. UI shows the extracted text next to the photo with a "Confirm this is correct" step. Timbre reads what the LABEL says. HARD SAFETY RULES: never compute or recommend doses beyond what is printed; never recommend a product; if the text is unreadable or ambiguous say so and advise checking the label or the local Krishi Vigyan Kendra; always show the pre-harvest interval and safety warnings prominently. Store the confirmed label data on the task.
11. **Ask anything**: voice Q&A ("kal spray kar sakta hoon?", "paani dena chahiye?") answered from CropProfile + tasks + forecast + rules-engine output, with a refusal-to-guess behavior when data is missing.

## P2 – only if P0 and P1 are polished
12. Harvest-stage handoff to a mandi price comparison (data.gov.in Agmarknet): nearby mandis ranked by price minus configurable transport cost, always showing the price's date and flagging missing data.
13. Second language, offline-tolerant PWA shell, 8 kHz "noisy phone" audio mode toggle for STT demo, shareable crop-timeline card.

# MOTION & VISUAL SPEC (this is where we win hearts)
- Scene layers (SVG, parallax, 60fps, no layout thrash): sky gradient driven by sun elevation and real cloud cover; sun/moon arc by local time; 3-depth clouds drifting at wind speed; rain/drizzle/storm particles sized by precipitation intensity with ground splashes and puddle sheen; lightning flash for thunderstorm codes; soil with moisture shading; crop rows whose sprite changes by growth stage (seed → sprout → vegetative → flowering → grain/bulb) with wind sway proportional to wind speed.
- Easing and feel: spring physics for the health bubble, staggered row reveals, smooth sky color interpolation between states (never hard cuts), subtle haptic-like micro-interactions on buttons, respects `prefers-reduced-motion`.
- UI: huge tap targets (≥56px), one primary action per screen, a giant mic button with live waveform, icons plus color plus voice (never text-only), strong contrast outdoors in sunlight, dark mode for night. Language of UI mostly spoken. A top-level three-tab layout: Khet (scene), Kaam (tasks), Baat (talk).
- Design tokens in one file; a considered earthy palette (not default Tailwind blue); typography that renders Devanagari and other scripts correctly.

# ENGINEERING QUALITY BAR
- TypeScript strict, zod validation on every LLM/API boundary, structured logging, graceful degradation (if Gnani or the weather API fails: show cached data with timestamp, never crash, never fabricate).
- Idempotent scheduler, timezone-correct date handling (Asia/Kolkata), unit tests for: rules engine, date parsing, task state machine, health score. At least one e2e test of the full voice-to-task flow using recorded audio fixtures.
- Latency budget: voice turn (speak → understood → spoken reply start) target under ~3s; stream TTS where possible; cache TTS for repeated phrases; show optimistic UI.
- Security: server-only keys, rate limiting, size limits on audio and image uploads, no PII in logs, EXIF stripped from images.
- Accessibility and honesty: every advisory shows its data source and timestamp; thresholds are visible in an "Advanced" screen.

# PROCESS (execute autonomously, report briefly at each checkpoint)
1. Read Gnani docs, run the smoke script, confirm the language overlap. Write a 1-page `ARCHITECTURE.md` and a task checklist. 
2. Build P0 vertically (thin slice first: speak a plan → see task → get alert), then deepen. Commit small, with working states at every commit.
3. Build P1. Spend real effort on animation polish; profile frame rate on a mid-range phone.
4. Add `DEMO_MODE` (env + visible badge) with scripted weather scenarios (clear → storm) for the demo video only; the real forecast path must remain the default.
5. Write `README.md` with setup in ≤5 commands, `.env.example`, a "Which Gnani APIs are used and where" table, known limitations, and a written project explanation (problem, users, how Prisma/Timbre are used, each member's contribution placeholder). Draft a 60-second demo script and a LinkedIn/X post draft including #GnaniAI #GreatIndianAIInternshipChallenge.
6. Deploy (Vercel or similar) so it can be shown running; keep a local fallback.

# DEFINITION OF DONE
A farmer says "parson spray karna hai"; the app confirms and creates the task; the monitor later flags rain and recommends skipping; next morning's briefing says so; the farmer reschedules by voice, later says "spray ho gaya", sees the spray animation and the health bubble improve; the label-upload flow reads a packet's printed instructions back faithfully; every verdict is explainable and traceable to real data. If something cannot be done safely or honestly in the time, cut it and say so, rather than faking it.

Start now. Ask me only for blockers (API key, chosen crops, languages). Otherwise decide, document assumptions in `ARCHITECTURE.md`, and ship. bro this is the one build it take whatever skills available online for designing evrythong which should look spremium,minilistic perfectly resembles online shown current eermging ai cool desings and ask me for apis for tts and stt apis of gnani cause these are mandoatory par tof project and for llm aksme when reuiqre di will provide groq api