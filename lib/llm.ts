/**
 * Single LLM interface over any OpenAI-compatible chat endpoint (Groq by default).
 * Every call returns zod-validated JSON; one repair retry with the validation
 * error is attempted, then it throws. Callers must handle failure honestly.
 */
import { z } from "zod";
import { log } from "@/lib/log";
import { NotConfiguredError } from "@/lib/gnani";

export interface LlmJsonRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  name: string;
  maxTokens?: number;
  image?: { dataUrl: string };
  model?: string;
}
export interface LlmClient {
  available(): boolean;
  json<T>(req: LlmJsonRequest<T>): Promise<T>;
}

const baseUrl = () => (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const key = () => process.env.LLM_API_KEY || "";
export const LLM_MODEL = () => process.env.LLM_MODEL || "openai/gpt-oss-120b";
/** Groq vision model (console.groq.com/docs/vision, Nov 2026). Never fall back to a text-only model for images. */
export const LLM_VISION_MODEL = () => process.env.LLM_VISION_MODEL || "qwen/qwen3.8-27b";

export class LlmHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const ChatResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ total_tokens: z.number().optional() }).optional(),
});

async function chat(messages: unknown[], model: string, maxTokens: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    };
    if (/gpt-oss/.test(model)) body.reasoning_effort = "low";
    else if (/qwen3/.test(model)) body.reasoning_effort = "none"; // instruct mode: no think tokens in JSON output
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new LlmHttpError(res.status, `llm http ${res.status}: ${t.slice(0, 160)}`);
    }
    const j = ChatResponse.parse(await res.json());
    return j.choices[0]!.message.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(s: string): unknown {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in LLM output");
  return JSON.parse(s.slice(start, end + 1));
}

export const llm: LlmClient = {
  available: () => key().length > 0,
  async json<T>(req: LlmJsonRequest<T>): Promise<T> {
    if (!this.available()) throw new NotConfiguredError("llm");
    const model = req.image ? req.model || LLM_VISION_MODEL() : req.model || LLM_MODEL();
    const userContent = req.image
      ? [{ type: "text", text: req.user }, { type: "image_url", image_url: { url: req.image.dataUrl } }]
      : req.user;
    const messages: { role: string; content: unknown }[] = [
      { role: "system", content: `${req.system}\nRespond with a single JSON object only.` },
      { role: "user", content: userContent },
    ];
    const t0 = Date.now();
    for (let attempt = 1; attempt <= 2; attempt++) {
      const out = await chat(messages, model, req.maxTokens ?? 600);
      try {
        const parsed = req.schema.parse(extractJson(out));
        log.info("llm.ok", { name: req.name, attempt, ms: Date.now() - t0 });
        return parsed;
      } catch (e) {
        const err = e instanceof z.ZodError ? JSON.stringify(e.issues).slice(0, 600) : (e as Error).message;
        log.warn("llm.invalid_json", { name: req.name, attempt });
        messages.push({ role: "assistant", content: out.slice(0, 2000) });
        messages.push({ role: "user", content: `That JSON was invalid: ${err}. Return corrected JSON only.` });
      }
    }
    throw new Error(`LLM output failed validation for ${req.name}`);
  },
};
