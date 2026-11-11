/**
 * LLM-backed understanding. The LLM only (a) maps utterances to intents/slots
 * and (b) phrases explanations of rules-engine output. It never computes dates
 * (returns the verbatim phrase) and never produces weather verdicts.
 */
import { z } from "zod";
import { llm } from "@/lib/llm";
import { IntentSchema, Irrigation, LandUnit, parseIntentRules, type Intent, type RuleContext } from "@/lib/nlu-rules";
import { CropId, type Lang } from "@/lib/config";
import { log } from "@/lib/log";

const INTENT_SYSTEM = `You understand short spoken messages from Indian farmers (Hindi, Hinglish, Telugu, romanised Telugu; STT output may contain errors).
Map the message to ONE intent for a farm task assistant.
kinds:
- create_task: farmer plans a field task ("parson spray karna hai", "kal paani dena hai", "repu mandu kottali")
- complete_task: says a task is finished ("spray ho gaya", "paani de diya", "ayipoyindi")
- start_task: says they are doing it right now ("spray kar raha hoon", "chestunna")
- reschedule_task: moves an existing task to a new day ("kal kar dunga", "somvar ko karenge")
- postpone_task: delays without a date ("baad mein karunga")
- cancel_task: drops the task ("nahi karna", "vaddu")
- keep: agrees / keep plan as is ("theek hai", "haan", "sare")
- deny: says no
- log_irrigation: says they irrigated when no irrigation task exists
- ask: asks a question (can I spray tomorrow? should I irrigate? weather?)
- unknown: anything else
taskType: spray | irrigate | fertilize | harvest | other | null. "dawa", "mandu", "pesticide" = spray. "paani", "sinchai", "neeru" = irrigate. "khad", "urea", "DAP", "eruvu" = fertilize. "katai", "kotha" = harvest.
datePhrase: copy the date/time words EXACTLY as spoken (e.g. "parson", "kal subah", "somvar", "ఎల్లుండి"); do NOT convert to a date. null if none.
askTopic (only for ask): can_do_task | should_irrigate | weather | task_status | other.
notes: short extra detail the farmer gave (product name, field part), else null.
JSON keys: kind, taskType, datePhrase, notes, askTopic.`;

export async function parseIntent(text: string, ctx: RuleContext, now: Date): Promise<Intent> {
  const rules = parseIntentRules(text, ctx, now);
  if (rules.confidence >= 0.8 || !llm.available()) return rules;
  try {
    const r = await llm.json({
      name: "intent",
      system: INTENT_SYSTEM,
      user: JSON.stringify({ message: text, activeTaskTypes: ctx.activeTypes, taskBeingDiscussed: ctx.focusType ?? null, mode: ctx.mode }),
      schema: IntentSchema,
      maxTokens: 400,
    });
    return { ...r, taskType: r.taskType ?? (r.kind === "keep" || r.kind === "reschedule_task" ? ctx.focusType ?? null : null), confidence: 0.8, source: "llm" };
  } catch (e) {
    log.warn("nlu.intent_llm_failed", { error: (e as Error).message });
    return rules;
  }
}

// ---------- onboarding extraction ----------
export const ProfileDraftSchema = z.object({
  crop: CropId.nullable().optional(),
  sowingPhrase: z.string().max(80).nullable().optional(),
  harvestPhrase: z.string().max(80).nullable().optional(),
  landSize: z.number().positive().max(5000).nullable().optional(),
  landUnit: LandUnit.nullable().optional(),
  place: z.string().max(80).nullable().optional(),
  irrigation: Irrigation.nullable().optional(),
});
export type ProfileDraft = z.infer<typeof ProfileDraftSchema>;

const PROFILE_SYSTEM = `Extract farm profile facts from a farmer's spoken answer (Hindi/Hinglish/Telugu; STT may have errors).
Only fill a field if the farmer actually said it; otherwise null. Never guess.
crop: wheat | rice | onion | null (gehun=wheat, dhaan/chawal/vari=rice, pyaaz/kanda/ulli=onion; other crops → null).
sowingPhrase: words describing WHEN it was sown, copied verbatim (e.g. "20 din pehle", "pichhle mahine", "15 tarikh"). Do not convert.
harvestPhrase: words describing expected harvest time, verbatim.
landSize: number; landUnit: acre | bigha | hectare | guntha | kanal.
place: village and/or district name as spoken, transliterated to Latin letters (e.g. "Peddada, Kakinada").
irrigation: canal | borewell | well | rainfed | drip | sprinkler | tank | other.
JSON keys: crop, sowingPhrase, harvestPhrase, landSize, landUnit, place, irrigation.`;

export async function extractProfileLLM(text: string, askedField: string, lang: Lang): Promise<ProfileDraft | null> {
  if (!llm.available()) return null;
  try {
    return await llm.json({
      name: "profile",
      system: PROFILE_SYSTEM,
      user: JSON.stringify({ questionAsked: askedField, language: lang, answer: text }),
      schema: ProfileDraftSchema,
      maxTokens: 400,
    });
  } catch (e) {
    log.warn("nlu.profile_llm_failed", { error: (e as Error).message });
    return null;
  }
}

// ---------- grounded Q&A (P1, used by "ask") ----------
const AnswerSchema = z.object({
  answer: z.string().min(1).max(500),
  grounded: z.boolean(),
  usedFacts: z.array(z.string()).max(8),
});
export async function answerGrounded(question: string, facts: unknown, lang: Lang): Promise<z.infer<typeof AnswerSchema> | null> {
  if (!llm.available()) return null;
  const system = `You are Khet Saathi, a careful farm assistant. Answer the farmer's question in ${lang === "te" ? "simple Telugu (Telugu script)" : "simple Hindi (Devanagari script)"}, 1-2 short spoken sentences.
Use ONLY the facts JSON (crop profile, tasks, forecast summary, rules-engine verdicts). The rules-engine verdict is authoritative: never contradict it, never invent weather, doses, products or yields.
If the facts do not answer the question, set grounded=false and say you don't know and suggest the local Krishi Vigyan Kendra.
JSON keys: answer, grounded, usedFacts (short names of facts used).`;
  try {
    return await llm.json({ name: "answer", system, user: JSON.stringify({ question, facts }), schema: AnswerSchema, maxTokens: 500 });
  } catch (e) {
    log.warn("nlu.answer_llm_failed", { error: (e as Error).message });
    return null;
  }
}
