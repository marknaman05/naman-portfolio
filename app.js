// Runtime for the prerendered build. Replaces the design-canvas React runtime
// with the handful of behaviours the page actually needs; the markup is already
// in the HTML, so this only toggles and wires it.
// Behaviour mirrors the <script data-dc-script> block in Portfolio.dc.html —
// change them together.
(() => {
  "use strict";

  const FORMSPREE_ID = "__FORMSPREE_ID__";
  const CONTACT_EMAIL = "__CONTACT_EMAIL__";

  const HINTS = ["try: experience", "try: skills", "try: wins", "try: contact", "try: all", "try: help"];
  const ROUTES = {
    all: ["metrics", "work", "skills", "wins", "contact"],
    work: ["work"], experience: ["work"],
    skills: ["skills"], stack: ["skills"],
    wins: ["wins"], achievements: ["wins"], education: ["wins"],
    numbers: ["metrics"], metrics: ["metrics"],
    contact: ["contact"], hire: ["contact", "metrics"], resume: ["contact"],
  };

  const $ = (sel) => document.querySelector(sel);
  const cmd = $("#cmd");
  const feedback = $("#feedback");
  const sections = [...document.querySelectorAll("[data-sec]")];
  const chips = [...document.querySelectorAll("[data-cmd]")];
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let route = "all";

  const apply = () => {
    const shown = ROUTES[route] || ROUTES.all;
    for (const s of sections) s.hidden = !shown.includes(s.dataset.sec);
    for (const c of chips) {
      const on = c.dataset.cmd === route;
      c.classList.toggle("tag-accent", on);
      c.classList.toggle("tag-neutral", !on);
      c.setAttribute("aria-pressed", String(on));
    }
  };

  const run = (raw) => {
    const c = String(raw || "").trim().toLowerCase().replace(/^[/>›\s]+/, "");
    if (!c) return;
    if (c === "help" || c === "?") {
      route = "all";
      cmd.value = "";
      feedback.textContent = "Commands: experience · skills · wins · numbers · contact · resume · all";
      apply();
      return;
    }
    if (ROUTES[c]) {
      const n = ROUTES[c].length;
      route = c;
      cmd.value = "";
      feedback.textContent = c === "all"
        ? "Showing the full edition — five sections."
        : `Filed: ${c} — ${n}${n === 1 ? " section." : " sections."}`;
      apply();
      cmd.blur();
      location.hash = c === "all" ? "" : c;
      return;
    }
    feedback.textContent = `No dispatch for “${c}”. Try help.`;
  };

  cmd.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); run(cmd.value); }
  });
  $("#run").addEventListener("click", () => run(cmd.value));
  for (const c of chips) c.addEventListener("click", () => run(c.dataset.cmd));

  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
      e.preventDefault();
      cmd.focus();
    }
  });

  if (!calm) {
    let i = 0;
    setInterval(() => { cmd.placeholder = HINTS[++i % HINTS.length]; }, 2600);
  }

  // deep links: /#skills opens on that section
  const fromHash = () => {
    const h = location.hash.slice(1).toLowerCase();
    if (ROUTES[h]) { route = h; apply(); }
  };
  addEventListener("hashchange", fromHash);

  // ---- contact form ----
  const form = $("#contact-form");
  const note = $("#form-note");
  const send = $("#send");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    if (!FORMSPREE_ID) {
      const subject = `Portfolio — ${data.get("name") || "hello"}`;
      const body = `${data.get("message")}\n\n— ${data.get("name")}\n${data.get("email")}`;
      note.textContent = "Opening your mail client…";
      location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return;
    }
    data.set("_subject", `Portfolio — ${data.get("name") || "new message"}`);
    send.disabled = true;
    send.textContent = "Sending…";
    note.textContent = "Sending…";
    try {
      const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method: "POST", body: data, headers: { Accept: "application/json" },
      });
      if (res.ok) {
        form.reset();
        note.textContent = "Filed. I reply within a day or two.";
      } else {
        // Formspree answers a rejection with { errors: [{ code, message }] } —
        // its own wording beats a generic failure line
        const body = await res.json().catch(() => null);
        const why = body?.errors?.[0]?.message || "That did not send";
        note.textContent = `${why} — or email ${CONTACT_EMAIL} directly.`;
      }
    } catch {
      note.textContent = `That did not send — email ${CONTACT_EMAIL} directly.`;
    } finally {
      send.disabled = false;
      send.textContent = "Send";
    }
  });

  fromHash();
  apply();
})();
