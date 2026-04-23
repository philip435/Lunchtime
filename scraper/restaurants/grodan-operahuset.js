import * as cheerio from "cheerio";

// Port of the Python reference parser for Grodan Kungliga Operan.
//
// Observed page structure:
//
//   <h2>Dagens Lunch</h2>
//   <h?>V. 17</h?>
//   <h?>Måndag- Fredag 11.30- 14.00 195 kr</h?>
//   <h?>Måndag</h?>            ← weekday heading (may wrap text in a span)
//   <h?|p>Tonkatsukyckling …</h?|p>
//   <h?>Tisdag</h?>
//   …
//   <h2>Grodans Raggmunk</h2>   ← section boundary at same level
//
// Walk document order. When we consume an element (weekday/week/price
// heading, or a dish element) we skip that element's entire subtree — so a
// <span> inside the heading is not re-read as the dish.

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
  const { ordered, subtreeEnd } = documentOrderTags($);
  const startIdx = ordered.indexOf(dagens);
  if (startIdx === -1) return null;

  let week = null;
  let priceNote = null;
  let pendingDay = null;
  let producedAny = false;
  const dishes = {};

  let i = subtreeEnd.get(dagens) ?? startIdx + 1;
  while (i < ordered.length) {
    const el = ordered[i];
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) { i++; continue; }

    const headingMatch = /^h([1-6])$/.exec(el.tagName);
    if (headingMatch) {
      const level = Number(headingMatch[1]);
      const lower = text.toLowerCase();

      if (level <= sectionLevel && producedAny && lower !== "dagens lunch") break;

      if (!week && /^v\.?\s*\d+/i.test(text)) {
        week = text;
        i = subtreeEnd.get(el);
        continue;
      }
      if (!priceNote && /\d{1,2}[.:]\d{2}/.test(text) && /kr/i.test(text)) {
        priceNote = text;
        i = subtreeEnd.get(el);
        continue;
      }
      if (DAYS_LOWER.includes(lower)) {
        pendingDay = DAYS[DAYS_LOWER.indexOf(lower)];
        producedAny = true;
        i = subtreeEnd.get(el);
        continue;
      }
      if (pendingDay) {
        dishes[pendingDay] = text;
        pendingDay = null;
        i = subtreeEnd.get(el);
        continue;
      }
      i++;
      continue;
    }

    if (pendingDay && isDishCandidate(el, text)) {
      dishes[pendingDay] = text;
      pendingDay = null;
      i = subtreeEnd.get(el);
      continue;
    }
    i++;
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

// Walk the DOM depth-first, emitting tags in document order. Also record
// each tag's subtree end (exclusive index into `ordered`) so callers can
// jump past an element's descendants in O(1).
function documentOrderTags($) {
  const ordered = [];
  const subtreeEnd = new Map();
  (function walk(node) {
    let myIdx = -1;
    if (node.type === "tag") {
      myIdx = ordered.length;
      ordered.push(node);
    }
    if (node.children) for (const c of node.children) walk(c);
    if (myIdx !== -1) subtreeEnd.set(node, ordered.length);
  })($.root().get(0));
  return { ordered, subtreeEnd };
}

function isDishCandidate(el, text) {
  if (!["p", "span", "div", "li", "strong", "em"].includes(el.tagName)) return false;
  if (text.length < 3 || text.length > 400) return false;
  return true;
}
