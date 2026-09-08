// Prerenders Portfolio.dc.html into a static, self-contained dist/.
//
// Portfolio.dc.html stays the design source and still round-trips to Claude
// Design. This drives it once in real Chrome, snapshots the mounted DOM, then
// strips the design-canvas runtime: React (fetched from unpkg at page load),
// support.js, image-slot.js and the base64 portrait sidecar all come out, and
// a small vanilla app.js goes in. Result is markup crawlers and link
// unfurlers can actually read.
//
//   node build.mjs [--site-url https://example.com]
//
// --site-url absolutizes og:image / og:url; without it, link previews on
// LinkedIn and Twitter will not resolve the image.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DS = "_ds/broadsheet-97b8f87f-77c9-4e64-aa55-ac037d05b6c2";
const PORT = 8912;
const CDP_PORT = 9412;

const siteUrl = (() => {
  const i = process.argv.indexOf("--site-url");
  return i > -1 ? process.argv[i + 1].replace(/\/$/, "") : "";
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".pdf": "application/pdf", ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

// ---------------------------------------------------------------- static server
const server = createServer((req, res) => {
  const path = join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  try {
    const body = readFileSync(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(PORT, r));

// ---------------------------------------------------------------------- chrome
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(ROOT, ".build-profile")}`, "--no-first-run",
  "--disable-gpu", "--window-size=1280,900", "about:blank",
], { stdio: "ignore" });

let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
    wsUrl = (await r.json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) throw new Error("Chrome did not expose a debug target");

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let msgId = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (!m.id || !pending.has(m.id)) return;
  const { res, rej } = pending.get(m.id);
  pending.delete(m.id);
  m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
});
const cdp = (method, params = {}) =>
  new Promise((res, rej) => { pending.set(++msgId, { res, rej }); ws.send(JSON.stringify({ id: msgId, method, params })); });
const evaluate = async (expression) => {
  const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "evaluate failed");
  return r.result.value;
};

await cdp("Runtime.enable");
await cdp("Page.enable");
await cdp("Page.navigate", { url: `http://127.0.0.1:${PORT}/Portfolio.dc.html` });

for (let i = 0; i < 80; i++) {
  if (await evaluate(`!!document.querySelector('input[aria-label="Command"]')`)) break;
  await sleep(250);
}
await evaluate(`(async () => {
  // the portrait arrives from the sidecar fetch; wait for real pixels
  for (let i = 0; i < 80; i++) {
    const s = document.querySelector('image-slot');
    const img = s?.shadowRoot?.querySelector('.frame img');
    if (img?.naturalWidth) return;
    await new Promise(r => setTimeout(r, 100));
  }
})()`);

// ------------------------------------------------------- extract + rewrite DOM
const portrait = await evaluate(`(() => {
  const img = document.querySelector('image-slot').shadowRoot.querySelector('.frame img');
  return { src: img.src, w: img.naturalWidth, h: img.naturalHeight };
})()`);

const state = JSON.parse(readFileSync(join(ROOT, ".image-slots.state.json"), "utf8")).portrait;
mkdirSync(join(DIST, "assets"), { recursive: true });
writeFileSync(join(DIST, "assets/portrait.webp"),
  Buffer.from(portrait.src.split(",")[1], "base64"));

const SECTIONS = [
  ["metrics", "By the numbers"],
  ["work", "The record"],
  ["projects", "Built with Claude"],
  ["skills", "The toolkit"],
  ["wins", "Achievements"],
  ["contact", "Send a wire"],
];

const html = await evaluate(`(() => {
  const norm = (s) => s.replace(/\\s+/g, ' ').trim().toLowerCase();

  // 1. tag the routable sections so app.js can toggle them
  const map = ${JSON.stringify(SECTIONS)};
  for (const [key, heading] of map) {
    const h = [...document.querySelectorAll('h2')].find(x => norm(x.innerText).startsWith(norm(heading)));
    const sec = h && h.closest('section');
    if (!sec) throw new Error('could not locate section: ' + key);
    sec.setAttribute('data-sec', key);
  }

  // 2. plain <img> in place of the editor's custom element. object-fit:cover
  //    plus a percentage transform reproduces the slot's saved pan/zoom, but
  //    responsively — the slot itself bakes pixel offsets for one width.
  const slot = document.querySelector('image-slot');
  const st = ${JSON.stringify(state)};
  const img = document.createElement('img');
  img.src = 'assets/portrait.webp';
  img.width = ${portrait.w};
  img.height = ${portrait.h};
  img.alt = 'Naman Ajay Markhedkar';
  img.setAttribute('fetchpriority', 'high');
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;'
    + 'transform:translate(' + st.x.toFixed(4) + '%,' + st.y.toFixed(4) + '%) scale(' + st.s.toFixed(4) + ');';
  const frame = document.createElement('div');
  frame.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
  frame.appendChild(img);
  slot.parentElement.style.position = 'relative';
  slot.replaceWith(frame);

  // 3. hooks for the vanilla runtime
  const cmd = document.querySelector('input[aria-label="Command"]');
  cmd.id = 'cmd'; cmd.value = ''; cmd.setAttribute('autocomplete', 'off');
  cmd.nextElementSibling.id = 'run';
  for (const b of document.querySelectorAll('button.tag')) {
    b.setAttribute('data-cmd', norm(b.innerText));
  }
  cmd.closest('section').querySelector('p').id = 'feedback';
  const form = document.querySelector('form');
  form.id = 'contact-form';
  form.querySelector('[role=status]').id = 'form-note';
  form.querySelector('button[type=submit]').id = 'send';

  // 4. the ticker's marquee is a baked inline animation; let it rest for
  //    anyone who asks for reduced motion
  const ticker = document.querySelector('div[style*="wire"]');
  if (ticker) ticker.classList.add('ticker');
  const extra = document.createElement('style');
  // several sections carry an inline display:grid, which outranks the UA's
  // [hidden]{display:none} — without !important the route toggle is a no-op
  // on exactly those two
  extra.textContent = '[data-sec][hidden]{display:none!important}'
    + '@media (prefers-reduced-motion: reduce){.ticker{animation:none!important}}';
  document.head.appendChild(extra);

  // 5. drop the design-canvas runtime; keep the design system's own bundle
  for (const s of [...document.querySelectorAll('script')]) {
    const src = s.getAttribute('src') || '';
    // React is injected by support.js at load time, so it is in the live DOM
    // rather than the source markup — match it here, not just the source tags
    if (s.hasAttribute('data-dc-script') || /support\\.js|image-slot\\.js|unpkg\\.com/.test(src)) s.remove();
  }
  for (const el of document.querySelectorAll('[data-dc-tpl]')) el.removeAttribute('data-dc-tpl');
  document.querySelector('x-dc')?.replaceWith(...document.querySelector('x-dc').childNodes);
  document.querySelector('helmet')?.remove();

  return '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
})()`);

chrome.kill();
server.close();

// ------------------------------------------------------------------ post-process
let out = html;
if (siteUrl) {
  out = out
    .replace(/(<meta property="og:image" content=")([^"]+)/, `$1${siteUrl}/assets/portrait.webp`)
    .replace(/<meta property="og:type"/, `<meta property="og:url" content="${siteUrl}/">\n<meta property="og:type"`);
}
out = out.replace("</body>", '<script src="app.js" defer></script>\n</body>');

// Microsoft Clarity. Injected here rather than into Portfolio.dc.html so the
// tag never runs during the headless build — if it did, the snapshot would
// bake in the loader script Clarity inserts at runtime and ship it twice.
const clarity = `<script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "yeo3c9or8i");
</script>
</head>`;
out = out.replace("</head>", clarity);

writeFileSync(join(DIST, "index.html"), out);

cpSync(join(ROOT, DS), join(DIST, DS), { recursive: true });
mkdirSync(join(DIST, "uploads"), { recursive: true });
copyFileSync(join(ROOT, "uploads/Resume_Naman_Ajay_Markhedkar.pdf"),
  join(DIST, "uploads/Resume_Naman_Ajay_Markhedkar.pdf"));
copyFileSync(join(ROOT, "favicon.svg"), join(DIST, "favicon.svg"));
copyFileSync(join(ROOT, "ads.txt"), join(DIST, "ads.txt"));

// dist/ is a plain static site — no framework for Vercel to detect, and no
// server-side routing to configure: app.js's #skills-style deep links are
// hash fragments, which never reach the server, so a catch-all rewrite would
// only turn genuine 404s (a broken asset path) into silent 200s
writeFileSync(join(DIST, "vercel.json"), JSON.stringify({
  cleanUrls: true,
  trailingSlash: false,
}, null, 2) + "\n");

// keep the form config in one place: read it off the design source
const source = readFileSync(join(ROOT, "Portfolio.dc.html"), "utf8");
const constant = (name) => (source.match(new RegExp(`const ${name} = '([^']*)'`)) || [, ""])[1];
writeFileSync(join(DIST, "app.js"), readFileSync(join(ROOT, "app.js"), "utf8")
  .replace("__FORMSPREE_ID__", constant("FORMSPREE_ID"))
  .replace("__CONTACT_EMAIL__", constant("CONTACT_EMAIL")));
rmSync(join(ROOT, ".build-profile"), { recursive: true, force: true });

const kb = (p) => (statSync(join(DIST, p)).size / 1024).toFixed(1).padStart(7);
console.log("dist/");
for (const f of ["index.html", "app.js", "favicon.svg", "assets/portrait.webp",
  `${DS}/styles.css`, `${DS}/_ds_bundle.js`, "uploads/Resume_Naman_Ajay_Markhedkar.pdf"]) {
  console.log(`${kb(f)} KB  ${f}`);
}
if (!siteUrl) console.log("\nnote: no --site-url given, og:image stays relative (link previews will not resolve it)");
