const DAYS = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"];

const state = {
  view: "today",
  restaurants: [],
  menus: new Map(),
};

async function loadRegistry() {
  const res = await fetch("data/restaurants.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`registry HTTP ${res.status}`);
  const { restaurants } = await res.json();
  return restaurants;
}

async function loadMenu(id) {
  const res = await fetch(`data/${id}/latest.json`, { cache: "no-cache" });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  return await res.json();
}

function todayName() {
  // getDay: 0=Sun..6=Sat → map to DAYS index (Mon=0).
  const d = new Date().getDay();
  const idx = d === 0 ? 6 : d - 1;
  return DAYS[idx] ?? null;
}

function render() {
  const app = document.getElementById("app");
  if (!state.restaurants.length) {
    app.innerHTML = `<p class="empty">Inga restauranger konfigurerade än.</p>`;
    return;
  }

  const today = todayName();
  const isWeekend = !today;

  const cards = state.restaurants.map((r) => {
    const menu = state.menus.get(r.id);
    if (!menu) return skeleton(r);
    if (menu.error) return errorCard(r, menu.error);
    return state.view === "today" && !isWeekend
      ? todayCard(r, menu, today)
      : weekCard(r, menu);
  });

  app.innerHTML = cards.join("");
  updateFooter();
}

function skeleton(r) {
  return `<section class="restaurant"><h2>${escape(r.name)}</h2><p class="meta">Laddar…</p></section>`;
}

function errorCard(r, err) {
  return `<section class="restaurant"><h2>${escape(r.name)}</h2><p class="meta">Kunde inte hämta menyn (${escape(err)}).</p></section>`;
}

function todayCard(r, menu, todayName) {
  const day = (menu.days || []).find((d) => d.day === todayName);
  return `
    <section class="restaurant">
      <h2>${escape(r.name)}</h2>
      <div class="meta">${escape(r.area || "")}${weekLabel(menu)}</div>
      ${priceNote(menu)}
      <div class="day-block">
        <h3>${escape(todayName)}</h3>
        ${renderDishes(day?.dishes)}
      </div>
    </section>`;
}

function weekCard(r, menu) {
  const blocks = DAYS.map((dayName) => {
    const day = (menu.days || []).find((d) => d.day === dayName);
    if (!day?.dishes?.length) return "";
    return `<div class="day-block"><h3>${escape(dayName)}</h3>${renderDishes(day.dishes)}</div>`;
  }).join("");

  return `
    <section class="restaurant">
      <h2>${escape(r.name)}</h2>
      <div class="meta">${escape(r.area || "")}${weekLabel(menu)}</div>
      ${priceNote(menu)}
      ${blocks || `<p class="empty">Ingen meny hittades.</p>`}
    </section>`;
}

function renderDishes(dishes) {
  if (!dishes?.length) return `<p class="empty">Ingen meny för idag.</p>`;
  return `<ul class="dishes">${dishes
    .map(
      (d) => `
        <li>
          ${d.price ? `<span class="dish-price">${d.price} kr</span>` : ""}
          ${d.category ? `<span class="dish-cat">${escape(d.category)}</span>` : ""}
          <span class="dish-name">${escape(d.name || "")}</span>
          ${d.description ? `<span class="dish-desc">${escape(d.description)}</span>` : ""}
        </li>`,
    )
    .join("")}</ul>`;
}

function weekLabel(menu) {
  if (!menu.weekNumber) return "";
  return ` · Vecka ${menu.weekNumber}`;
}

function priceNote(menu) {
  return menu.priceNote ? `<p class="price-note">${escape(menu.priceNote)}</p>` : "";
}

function updateFooter() {
  const first = state.menus.values().next().value;
  if (!first?.scrapedAt) return;
  const d = new Date(first.scrapedAt);
  document.getElementById("updated").textContent = ` Uppdaterat ${d.toLocaleString("sv-SE")}.`;
  const link = document.getElementById("source-link");
  if (first.sourceUrl) {
    link.href = first.sourceUrl;
    link.textContent = "källa";
  }
}

function escape(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wireTabs() {
  for (const btn of document.querySelectorAll(".tab")) {
    btn.addEventListener("click", () => {
      for (const b of document.querySelectorAll(".tab")) b.classList.remove("active");
      btn.classList.add("active");
      state.view = btn.dataset.view;
      render();
    });
  }
}

async function main() {
  wireTabs();
  try {
    state.restaurants = await loadRegistry();
    render();
    await Promise.all(
      state.restaurants.map(async (r) => {
        state.menus.set(r.id, await loadMenu(r.id));
        render();
      }),
    );
  } catch (err) {
    document.getElementById("app").innerHTML = `<p class="error">${escape(err.message)}</p>`;
  }
}

main();
