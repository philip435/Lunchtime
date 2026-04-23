import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You extract weekly lunch menus from Swedish restaurant websites.

Return ONLY valid JSON, no prose, no markdown fences. Shape:
{
  "weekNumber": <int or null>,
  "year": <int or null>,
  "currency": "SEK",
  "priceNote": <string or null>,
  "days": [
    {
      "day": "Måndag" | "Tisdag" | "Onsdag" | "Torsdag" | "Fredag",
      "dishes": [
        { "name": "<Swedish dish name>", "description": "<optional description or null>", "category": "<Kött|Fisk|Vegetariskt|Veckans|null>", "price": <number or null> }
      ]
    }
  ]
}

Rules:
- Only include days you actually find a menu for. Don't invent dishes.
- If the page shows one shared price (e.g. "Dagens lunch 165 kr"), put it in priceNote and leave per-dish price null.
- Preserve Swedish text verbatim. Don't translate.
- If no menu is present, return {"weekNumber": null, "year": null, "currency": "SEK", "priceNote": null, "days": []}.`;

export async function extractMenuWithClaude({ html, pdfBuffer, restaurantName }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set — cannot use Claude fallback");
  }
  const client = new Anthropic({ apiKey });

  const userContent = pdfBuffer
    ? [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: pdfBuffer.toString("base64"),
          },
        },
        { type: "text", text: `Restaurant: ${restaurantName}\n\nExtract the weekly lunch menu from the attached PDF.` },
      ]
    : `Restaurant: ${restaurantName}\n\nHTML (trimmed to body):\n\n${stripToBody(html).slice(0, 60_000)}`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return parseJsonLoose(text);
}

function stripToBody(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Claude did not return valid JSON:\n" + text.slice(0, 500));
  }
}
