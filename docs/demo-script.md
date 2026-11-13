# Khet Saathi: 60-second demo script

**Setup before recording**
- Run with `DEMO_MODE=1` and onboard as wheat in Kanpur (or reset with `POST /api/reset`).
- Scenario `clear` is set: `curl -X POST localhost:3000/api/demo -H 'content-type: application/json' -d '{"scenario":"clear"}'`.
- Record on a phone-sized viewport with sound on. Prisma and Timbre are live; only the weather overlay is scripted.
- The **DEMO** badge must be visible whenever a scenario is active. Don't crop it out.

| Time | Farmer says (Hindi) · *English gloss* | On screen | App says (Timbre) |
|---|---|---|---|
| **0:00–0:06** | none | Title card: *"Khet Saathi: a farmer's voice-first crop companion"*. Cut to the Khet tab: animated wheat field, real IST sky, Care Score orb breathing. | none |
| **0:06–0:15** | 🎙️ **"कल गेहूं में स्प्रे करना है।"** *"I need to spray the wheat tomorrow."* | Baat tab, mic held, live waveform. The Prisma transcript appears in a bubble. Cut to Kaam: new **Spray · tomorrow** card with a green **GO** chip. | "ठीक है, कल स्प्रे लिख लिया। अभी मौसम ठीक लग रहा है।" *"Okay, noted spray for tomorrow. Weather looks fine for now."* |
| **0:15–0:18** | none | Caption: *"Prisma STT → intent → rules engine → Timbre TTS. The verdict comes from rules on Open-Meteo data, not the LLM."* Tap the card to show reasons, thresholds, source and timestamp. | none |
| **0:18–0:28** | none | ⚠️ **DEMO MODE MOMENT.** Caption on screen: *"DEMO MODE: scripted storm overlay so the storm can be shown on cue (badged in app)."* Off-camera: `POST /api/demo {"scenario":"storm"}`. The **DEMO** badge is visible, the sky darkens, rain and lightning start, the crop sways. The alert banner drops in and the card flips to **SKIP_TODAY / WAIT** (rain %, wind km/h vs threshold, source `demo`). | "कल दोपहर से तेज़ बारिश और आंधी की संभावना है, कल स्प्रे मत कीजिए।" *"Heavy rain and storm likely from tomorrow afternoon. Don't spray tomorrow."* (plus the better window if the engine found one) |
| **0:28–0:38** | 🎙️ **"ठीक है, कल सुबह कर दूंगा।"** *"Okay, I'll do it tomorrow morning."* (use the better window the app actually names; the scripted storm starts tomorrow 12:00 IST and runs until day-after 20:00) | Transcript bubble. The card moves to the morning slot and is re-evaluated (its chip updates). | Confirms the new time and its verdict in one sentence. |
| **0:38–0:44** | 🎙️ **"परसों स्प्रे कर सकता हूँ?"** *"Can I spray the day after tomorrow?"* | Grounded answer bubble that cites the rules result. | Answer comes from the rules engine (no, the storm continues), and it doesn't guess. |
| **0:44–0:54** | 🎙️ **"स्प्रे हो गया।"** *"Spraying's done."* *(cut: switch scenario to `clear` first, so the field is calm)* | Card turns **done** and the celebration plays. Khet tab: the Care Score orb springs up. Tap it to show the factor breakdown and the line *"care score based on your inputs and weather, not a yield claim."* | "बहुत बढ़िया, स्प्रे पूरा दर्ज कर लिया।" *"Great, spray marked complete."* |
| **0:54–1:00** | none | End card: *"Gnani Prisma (STT) + Timbre (TTS) · Open-Meteo · deterministic rules · no dose advice."* Name: Putta Meher Prakash · #GnaniAI #GreatIndianAIInternshipChallenge | none |

**Notes for the edit**
- The Timbre lines above are close to what `lib/speech.ts` generates. Use whatever the app actually says on the take; don't dub over it.
- If a turn is slow, trim the dead air but keep the transcript bubble on screen so it's clear the speech went through Prisma.
- Don't show the time scrubber or label reading unless they're finished and merged before recording.
