import * as cheerio from "cheerio";

// Port of the Python reference parser. Grodan's page structure (observed):
//
//   <h2>Dagens Lunch</h2>
//   <h?>V. 17</h?>
//   <h?>Måndag- Fredag 11.30- 14.00 195 kr</h?>
//   <h?>Måndag</h?>
//   <h?|p>Tonkatsukyckling med picklade grönsaker …</h?>
//   <h?>Tisdag</h?>
//   …
//   <h2>Grodans Raggmunk</h2>   ← section boundary at same level
//
// Strategy: locate the "Dagens Lunch" heading, then walk the document in
// order. Week number, price/hours line, day headings, and dish lines are
// identified by simple regex / membership tests. Boundary is another
// heading at the same level once we've consumed at least one weekday.

const DAYS = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"];
const DAYS_LOWER = DAYS.map((d) => d.toLowerCase());

export function parse(html) {
  const $ = cheerio.load(html);

  let dagens = null;
  $("h1,h2,h3,h4,h5,h6").each((_, el) => {
    if (!dagens && $(el).text().trim().toLowerCase() === "dagens lunch") {
      dagens = el;
    }
  });
  if (!dagens) return null;

  const sectionLevel = Number(dagens.tagName[1]);
  const ordered = documentOrderTags($);
  const startIdx = ordered.indexOf(dagens);
  if (startIdx === -1) return null;

  let week = null;
  let priceNote = null;
  let pendingDay = null;
  let producedAny = false;
  const dishes = {};

  for (const el of ordered.slice(startIdx + 1)) {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) continue;

    const headingMatch = /^h([1-6])$/.exec(el.tagName);
    if (headingMatch) {
      const level = Number(headingMatch[1]);
      const lower = text.toLowerCase();

      if (level <= sectionLevel && producedAny && lower !== "dagens lunch") break;

      if (!week && /^v\.?\s*\d+/i.test(text)) {
        week = text;
        continue;
      }
      if (!priceNote && /\d{1,2}[.:]\d{2}/.test(text) && /kr/i.test(text)) {
        priceNote = text;
        continue;
      }
      if (DAYS_LOWER.includes(lower)) {
        pendingDay = DAYS[DAYS_LOWER.indexOf(lower)];
        producedAny = true;
        continue;
      }
      if (pendingDay) {
        dishes[pendingDay] = text;
        pendingDay = null;
        continue;
      }
    } else if (pendingDay && isDishCandidate(el, text)) {
      dishes[pendingDay] = text;
      pendingDay = null;
    }
  }

  const weekNumber = week ? Number((week.match(/\d+/) || [])[0]) : null;
  const flatPrice = priceNote
    ? Number((priceNote.match(/(\d{2,4})\s*kr/i) || [])[1]) || null
    : null;

  const daysArr = DAYS.filter((d) => dishes[d]).map((d) => ({
    day: d,
    dishes: [
      { name: dishes[d], description: null, category: null, price: flatPrice },
    ],
  }));

  if (!daysArr.length) return null;

  return {
    weekNumber,
    year: new Date().getFullYear(),
    currency: "SEK",
    priceNote,
    days: daysArr,
  };
}

function documentOrderTags($) {
  const result = [];
  (function walk(node) {
    if (node.type === "tag") result.push(node);
    if (node.children) for (const c of node.children) walk(c);
  })($.root().get(0));
  return result;
}

// A dish line is typically a <p>, <span>, <div>, or similar — not a container
// that wraps further structure. Reject elements that contain other headings
// or nested block children with their own text.
function isDishCandidate(el, text) {
  if (!["p", "span", "div", "li", "strong", "em"].includes(el.tagName)) return false;
  if (text.length < 3 || text.length > 400) return false;
  return true;
}
