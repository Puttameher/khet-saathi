import { z } from "zod";
import cropsJson from "@/config/crops.json";
import rulesJson from "@/config/spray-rules.json";
import appJson from "@/config/app.json";

export const CropId = z.enum(["wheat", "rice", "onion"]);
export type CropId = z.infer<typeof CropId>;
export const StageId = z.enum(["seed", "sprout", "vegetative", "flowering", "grain", "bulb"]);
export type StageId = z.infer<typeof StageId>;
export const Lang = z.enum(["hi", "te"]);
export type Lang = z.infer<typeof Lang>;

const StageSchema = z.object({
  id: StageId,
  fromDay: z.number().int().min(0),
  toDay: z.number().int().min(1),
  label: z.object({ hi: z.string(), te: z.string() }),
});
const CropSchema = z.object({
  names: z.object({ en: z.string(), hi: z.string(), hinglish: z.string(), te: z.string() }),
  aliases: z.array(z.string()).min(1),
  totalDays: z.number().int().positive(),
  stages: z.array(StageSchema).min(1),
});
const CropsFile = z.object({
  _note: z.string(),
  _verified: z.boolean(),
  crops: z.object({ wheat: CropSchema, rice: CropSchema, onion: CropSchema }),
});
export type CropDef = z.infer<typeof CropSchema>;

export const RulesSchema = z.object({
  _note: z.string(),
  version: z.number().int(),
  windowHours: z.number().int().min(1).max(12),
  dayStartHour: z.number().int().min(0).max(23),
  dayEndHour: z.number().int().min(1).max(23),
  spray: z.object({
    rainProbabilityWait: z.number(),
    rainProbabilitySkip: z.number(),
    rainMmWait: z.number(),
    rainMmSkip: z.number(),
    windKmhWait: z.number(),
    windKmhSkip: z.number(),
    gustKmhWait: z.number(),
    heatCWait: z.number(),
    heatCSkip: z.number(),
    humidityFungalRiskPct: z.number(),
    thunderCodes: z.array(z.number().int()),
  }),
  fertilize: z.object({ rainMmSkip: z.number(), rainProbabilityWait: z.number(), rainMmWait: z.number() }),
  irrigate: z.object({ rainMmSkip24h: z.number(), rainMmWait24h: z.number(), rainProbabilityWait24h: z.number() }),
  harvest: z.object({ rainProbabilityWait: z.number(), rainMmSkip: z.number(), thunderCodes: z.array(z.number().int()) }),
});
export type RulesConfig = z.infer<typeof RulesSchema>;

const LangCfg = z.object({
  label: z.string(),
  sttLanguageCode: z.string(),
  sttFormat: z.enum(["verbatim", "transcribe", "codemix", "transliterate"]),
  ttsLanguage: z.string(),
  ttsVoice: z.string(),
});
const AppSchema = z.object({
  timezone: z.literal("Asia/Kolkata"),
  monitorTimes: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1),
  weatherCacheMinutes: z.number().int().positive(),
  languages: z.object({ hi: LangCfg, te: LangCfg }),
  limits: z.object({ audioMaxBytes: z.number().int(), imageMaxBytes: z.number().int(), textMaxChars: z.number().int() }),
});
export type AppConfig = z.infer<typeof AppSchema>;

export const CROPS = CropsFile.parse(cropsJson);
export const RULES: RulesConfig = RulesSchema.parse(rulesJson);
export const APP: AppConfig = AppSchema.parse(appJson);

export function monitorTimes(): string[] {
  const env = process.env.MONITOR_TIMES;
  if (env) {
    const parts = env.split(",").map((s) => s.trim()).filter((s) => /^\d{2}:\d{2}$/.test(s));
    if (parts.length) return parts;
  }
  return APP.monitorTimes;
}

export function cropStage(crop: CropId, daysSinceSowing: number): { stage: StageId; progress: number; label: { hi: string; te: string } } {
  const def = CROPS.crops[crop];
  const d = Math.max(0, daysSinceSowing);
  const last = def.stages[def.stages.length - 1]!;
  const st = def.stages.find((s) => d >= s.fromDay && d < s.toDay) ?? last;
  return { stage: st.id, progress: Math.min(1, d / def.totalDays), label: st.label };
}

export function matchCrop(text: string): CropId | null {
  const t = text.normalize("NFC").toLowerCase();
  for (const id of CropId.options) {
    for (const a of CROPS.crops[id].aliases) {
      const re = new RegExp(`(?<![\\p{L}\\p{M}])${a.toLowerCase()}(?![\\p{L}\\p{M}])`, "u");
      if (re.test(t)) return id;
    }
  }
  return null;
}
