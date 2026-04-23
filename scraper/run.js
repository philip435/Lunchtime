import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchDocument } from "./fetch.js";
import { extractMenuWithClaude } from "./claude.js";
import { isoWeek, mondayOf, weekKey } from "./week.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

async function loadRegistry() {
  const raw = await readFile(path.join(DATA_DIR, "restaurants.json"), "utf8");
  return JSON.parse(raw).restaurants;
}

async function loadParser(id) {
  try {
    return await import(`./restaurants/${id}.js`);
  } catch {
    return null;
  }
}

async function scrapeOne(r) {
  const resolvedUrl = resolveUrl(r.url);
  console.log(`\n→ ${r.name} (${resolvedUrl})`);
  const doc = await fetchDocument(resolvedUrl);
  console.log(`  fetched ${doc.kind === "pdf" ? `${doc.buffer.length} bytes (pdf)` : `${doc.html.length} bytes (html)`}`);

  const parser = doc.kind === "html" ? await loadParser(r.parser) : null;
  let menu = null;
  let source = "none";

  if (parser?.parse && process.env.FORCE_CLAUDE !== "1") {
    try {
      menu = parser.parse(doc.html);
      if (menu) source = "selector";
    } catch (err) {
      console.warn(`  selector parse threw: ${err.message}`);
    }
  }

  if (!menu || !menu.days?.length) {
    console.log(`  ${doc.kind === "pdf" ? "pdf source" : "selector parse empty"} — using Claude`);
    menu = await extractMenuWithClaude({
      html: doc.kind === "html" ? doc.html : undefined,
      pdfBuffer: doc.kind === "pdf" ? doc.buffer : undefined,
      restaurantName: r.name,
    });
    source = "claude";
  }

  normalize(menu);

  const scrapedAt = new Date().toISOString();
  const payload = {
    restaurantId: r.id,
    restaurantName: r.name,
    sourceUrl: resolvedUrl,
    scrapedAt,
    extractedBy: source,
    ...menu,
  };

  const outDir = path.join(DATA_DIR, r.id);
  const historyDir = path.join(outDir, "history");
  if (!existsSync(historyDir)) await mkdir(historyDir, { recursive: true });

  await writeFile(path.join(outDir, "latest.json"), JSON.stringify(payload, null, 2) + "\n");
  await writeFile(
    path.join(historyDir, `${weekKey()}.json`),
    JSON.stringify(payload, null, 2) + "\n",
  );

  console.log(`  wrote latest.json + history/${weekKey()}.json (source=${source}, days=${menu.days?.length ?? 0})`);
}

// Post-process the menu in place: default year to current, and if priceNote
// carries a single shared price and no dish has its own price, stamp that
// shared price onto each dish so the UI and history data are consistent
// regardless of whether the selector parser or Claude produced the menu.
function normalize(menu) {
  if (!menu) return;
  if (!menu.year) menu.year = new Date().getFullYear();
  if (!menu.currency) menu.currency = "SEK";

  const shared = extractSharedPrice(menu.priceNote);
  if (!shared || !menu.days) return;

  for (const day of menu.days) {
    for (const dish of day.dishes ?? []) {
      if (dish.price == null) dish.price = shared;
    }
  }
}

// Substitute {YEAR}/{MONTH}/{WEEK} using the ISO week of today's date, with
// MONTH taken from the Monday of that week (the day WordPress uses when
// filing weekly menu uploads into /YYYY/MM/ buckets).
function resolveUrl(template) {
  if (!template.includes("{")) return template;
  const { year, week } = isoWeek();
  const monday = mondayOf();
  const month = String(monday.getMonth() + 1).padStart(2, "0");
  return template
    .replaceAll("{YEAR}", String(year))
    .replaceAll("{MONTH}", month)
    .replaceAll("{WEEK}", String(week));
}

function extractSharedPrice(note) {
  if (!note) return null;
  const m = note.match(/(\d{2,4})\s*(kr|:-|SEK)/i);
  return m ? Number(m[1]) : null;
}

async function main() {
  const filter = process.argv[2];
  const registry = await loadRegistry();
  const targets = filter ? registry.filter((r) => r.id === filter) : registry;

  if (!targets.length) {
    console.error(`No restaurants matched "${filter}"`);
    process.exit(1);
  }

  const failures = [];
  for (const r of targets) {
    try {
      await scrapeOne(r);
    } catch (err) {
      console.error(`  ✗ ${r.id}: ${err.message}`);
      failures.push({ id: r.id, error: err.message });
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} restaurant(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
