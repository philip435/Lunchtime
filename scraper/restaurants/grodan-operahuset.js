import * as cheerio from "cheerio";

const DAYS = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"];

// Selector-based parser. Tries a few common WordPress-ish layouts.
// Returns a parsed menu object, or null if nothing plausible was found
// (in which case the runner falls back to Claude).
export function parse(html) {
  const $ = cheerio.load(html);

  const candidates = [
    ".lunch-menu",
    "#lunch",
    "#lunchmeny",
    ".lunchmeny",
    "[class*='lunch']",
    "main",
  ];

  for (const sel of candidates) {
    const scope = $(sel).first();
    if (!scope.length) continue;
    const text = scope.text();
    if (!DAYS.some((d) => text.includes(d))) continue;

    const days = extractDays(scope, $);
    if (days.length >= 3) {
      return {
        weekNumber: extractWeek(text),
        year: new Date().getFullYear(),
        currency: "SEK",
        priceNote: extractPriceNote(text),
        days,
      };
    }
  }

  return null;
}

function extractDays(scope, $) {
  // Walk the DOM. Any element whose own text starts with a day name becomes
  // a section boundary; we collect text from following siblings (or children
  // if the day sits in a parent container) until the next day heading.
  const result = [];
  const dayEls = [];
  scope.find("*").each((_, el) => {
    const own = $(el).clone().children().remove().end().text().trim();
    const match = own.match(new RegExp(`^(${DAYS.join("|")})\\b`));
    if (match) dayEls.push({ el, day: match[1] });
  });

  for (let i = 0; i < dayEls.length; i++) {
    const { el, day } = dayEls[i];
    const nextEl = dayEls[i + 1]?.el ?? null;
    const lines = collectLinesBetween($, el, nextEl);
    const dishes = linesToDishes(lines);
    if (dishes.length) result.push({ day, dishes });
  }

  return dedupeByDay(result);
}

function collectLinesBetween($, startEl, endEl) {
  const lines = [];
  // Following siblings of startEl and its ancestors, up to endEl.
  let node = startEl;
  const visited = new Set();
  while (node && node !== endEl) {
    let sib = $(node).next();
    while (sib.length && sib.get(0) !== endEl) {
      if (visited.has(sib.get(0))) break;
      visited.add(sib.get(0));
      const txt = sib.text().replace(/\s+/g, " ").trim();
      if (txt) lines.push(...txt.split(/\n|•|•|\|/).map((s) => s.trim()).filter(Boolean));
      sib = sib.next();
    }
    node = $(node).parent().get(0);
    if (!node || node.tagName === "body" || node.tagName === "html") break;
  }
  return lines;
}

function linesToDishes(lines) {
  return lines
    .filter((s) => s.length > 3 && s.length < 300)
    .filter((s) => !DAYS.some((d) => s.startsWith(d)))
    .slice(0, 6)
    .map((line) => {
      const priceMatch = line.match(/(\d{2,4})\s*(kr|:-|SEK)/i);
      const price = priceMatch ? Number(priceMatch[1]) : null;
      const name = line.replace(/(\d{2,4})\s*(kr|:-|SEK)/i, "").trim();
      return { name, description: null, category: null, price };
    });
}

function extractWeek(text) {
  const m = text.match(/[Vv]ecka\s*(\d{1,2})/);
  return m ? Number(m[1]) : null;
}

function extractPriceNote(text) {
  const m = text.match(/[^.\n]*(\d{2,4})\s*(kr|:-|SEK)[^.\n]*/i);
  return m ? m[0].trim().slice(0, 140) : null;
}

function dedupeByDay(days) {
  const seen = new Set();
  return days.filter((d) => {
    if (seen.has(d.day)) return false;
    seen.add(d.day);
    return true;
  });
}
