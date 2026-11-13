# Social post drafts

## LinkedIn (~150 words)

For Gnani AI's Great Indian AI Internship Challenge, I built **Khet Saathi**, a voice-first crop companion for farmers.

A farmer says "कल स्प्रे करना है" (I need to spray tomorrow). Gnani Prisma transcribes it, the app saves a task, and a rules engine checks the Open-Meteo forecast three times a day. If rain or strong wind is coming, it raises an alert. The next morning a Gnani Timbre voice briefing tells the farmer to wait or skip, and they can reschedule just by speaking.

A few choices I made deliberately:
• Weather verdicts come from deterministic rules, not an LLM. Every advisory shows its data source and timestamp.
• The LLM only interprets what the farmer meant. It never invents dates or verdicts.
• No pesticide dose advice, and the "care score" is labelled as not a yield claim.

It works in Hindi/Hinglish, with Telugu support.

Demo: [demo video link]

#GnaniAI #GreatIndianAIInternshipChallenge

## X (≤280 chars)

Built Khet Saathi for Gnani AI's challenge: a farmer says "कल स्प्रे करना है", Gnani Prisma hears it, rules check the forecast, Timbre says go/wait/skip. No LLM-made verdicts, no dose advice.

[demo video link]

#GnaniAI #GreatIndianAIInternshipChallenge
