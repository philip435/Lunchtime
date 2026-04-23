const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": USER_AGENT,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
};

export async function fetchHtml(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Fetch ${url} failed: HTTP ${res.status}`);
  }
  return await res.text();
}

// Fetches a URL and classifies the payload as HTML or PDF so callers can
// route binary menus (e.g. weekly PDFs) to Claude's document input instead
// of trying to parse them as HTML.
export async function fetchDocument(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Fetch ${url} failed: HTTP ${res.status}`);
  }
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const isPdf =
    contentType.includes("application/pdf") ||
    new URL(url).pathname.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    const buffer = Buffer.from(await res.arrayBuffer());
    return { kind: "pdf", buffer, contentType };
  }
  return { kind: "html", html: await res.text(), contentType };
}
