import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchHtml } from "./fetch.js";
import { extractMenuWithClaude } from "./claude.js";
import { weekKey } from "./week.js";

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
  console.log(`\n→ ${r.name} (${r.url})`);
  const html = await fetchHtml(r.url);
  console.log(`  fetched ${html.length} bytes`);

  const parser = await loadParser(r.parser);
  let menu = null;
  let source = "none";

  if (parser?.parse && process.env.FORCE_CLAUDE !== "1") {
    try {
      menu = parser.parse(html);
      if (menu) source = "selector";
    } catch (err) {
      console.warn(`  selector parse threw: ${err.message}`);
    }
  }

  if (!menu || !menu.days?.length) {
    console.log("  selector parse empty — falling back to Claude");
    menu = await extractMenuWithClaude({ html, restaurantName: r.name });
    source = "claude";
  }

  const scrapedAt = new Date().toISOString();
  const payload = {
    restaurantId: r.id,
    restaurantName: r.name,
    sourceUrl: r.url,
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
