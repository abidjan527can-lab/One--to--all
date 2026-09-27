// One-to-All: Unified AI Chat Completion — dual provider
// Codestral (coding) → Mistral direct API (fastest)
// Everything else  → OpenRouter
//
// Secrets: the Mistral key (mstrl_...) and the OpenRouter key (sk-or-v1-...)

interface ChatRequest {
  model?: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const DEFAULT_MODEL = "codestral-latest";

// Models routed to Mistral's direct API (Codestral family)
const MISTRAL_MODELS = new Set(["codestral-latest", "codestral-2508", "mistralai/codestral-2508"]);

const AVAILABLE_MODELS = [
  { id: "codestral-latest", label: "Codestral (Mistral direct)", tag: "coding", provider: "mistral" },
  { id: "mistralai/codestral-2508", label: "Codestral 2508 (OpenRouter)", tag: "coding", provider: "openrouter" },
  { id: "cohere/north-mini-code:free", label: "North Mini Code", tag: "coding", provider: "openrouter" },
  { id: "qwen/qwen3.8-27b:free", label: "Qwen 3.8 27B", tag: "coding", provider: "openrouter" },
  { id: "deepseek/deepseek-r1", label: "DeepSeek R1", tag: "reasoning+code", provider: "openrouter" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek V3", tag: "chat+code", provider: "openrouter" },
  { id: "meta-llama/llama-4-scout", label: "Llama 4 Scout", tag: "chat", provider: "openrouter" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini", tag: "chat", provider: "openrouter" },
];

// The Mistral key (mstrl_...) was auto-saved by the platform under this name
function getMistralKey(): string | undefined {
  const k = Deno.env.get("OPENROUTER_API_KEY_5") || "";
  return k.startsWith("mstrl_") ? k : undefined;
}

function getOpenRouterKey(): string | undefined {
  return Deno.env.get("OPENROUTER_API_KEY");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ total: AVAILABLE_MODELS.length, models: AVAILABLE_MODELS, default: DEFAULT_MODEL }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }

  try {
    const body: ChatRequest = await req.json();
    const requested = body.model || DEFAULT_MODEL;
    const messages = body.messages;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing required field: messages[]" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const useMistral = MISTRAL_MODELS.has(requested);
    const mistralKey = getMistralKey();
    const openrouterKey = getOpenRouterKey();

    // --- Mistral direct (Codestral) ---
    if (useMistral && mistralKey) {
      const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${mistralKey}`,
        },
        body: JSON.stringify({
          model: "codestral-latest",
          messages,
          temperature: body.temperature ?? 0.7,
          max_tokens: body.max_tokens ?? 2000,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return new Response(
          JSON.stringify({
            id: data.id,
            model: data.model || "codestral-latest",
            provider: "mistral",
            choices: data.choices,
            usage: data.usage,
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...CORS } }
        );
      }
      // If Mistral fails, fall through to OpenRouter (if we have that key)
    }

    // --- OpenRouter (all models + Codestral fallback) ---
    if (!openrouterKey) {
      return new Response(
        JSON.stringify({
          error: "No AI provider key configured",
          message: "Add a free OPENROUTER_API_KEY from https://openrouter.ai/keys to activate.",
        }),
        { status: 503, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Map Mistral-direct ids to the OpenRouter equivalent
    const orModel = MISTRAL_MODELS.has(requested) ? "mistralai/codestral-2508" : requested;

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openrouterKey}`,
        "HTTP-Referer": "https://one-to-all.app",
        "X-Title": "One-to-All",
      },
      body: JSON.stringify({
        model: orModel,
        messages,
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 2000,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = errText;
      try { errMsg = JSON.parse(errText).error?.message || errText; } catch {}
      return new Response(
        JSON.stringify({ error: "Provider error", message: errMsg }),
        { status: res.status, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const data = await res.json();
    return new Response(
      JSON.stringify({
        id: data.id,
        model: data.model || orModel,
        provider: "openrouter",
        choices: data.choices,
        usage: data.usage,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: "Chat completion failed", message: err.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
});
