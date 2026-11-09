/* Project: Apocalypse — рендер данных из data/*.json */

const DATA = "data/site.json";
const STATUS = "data/status.json";

async function loadJSON(path) {
  try {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.warn(`Не удалось загрузить ${path}:`, err.message);
    return null;
  }
}

/* ── Подсветка текущей страницы в меню ─────────────────── */

function markCurrentPage() {
  const here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav a").forEach((a) => {
    const target = a.getAttribute("href");
    if (target === here || (here === "" && target === "index.html")) {
      a.setAttribute("aria-current", "page");
    }
  });
}

/* ── Ссылки на Discord ─────────────────────────────────── */

function applyDiscordLinks(site) {
  const invite = site?.project?.discord_invite;
  if (!invite || invite.includes("ЗАМЕНИ")) return;
  document.querySelectorAll("[data-discord]").forEach((el) => {
    el.setAttribute("href", invite);
  });
}

/* ── Мониторинг серверов ───────────────────────────────── */

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(diff)) return "неизвестно когда";
  if (diff < 90) return "только что";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}

function copyButton(address) {
  return `
    <div class="address">
      <code>${address}</code>
      <button type="button" data-copy="${address}">копировать</button>
    </div>`;
}

function statusBlock(state) {
  const map = {
    online: ["status--online", "онлайн"],
    offline: ["status--offline", "офлайн"],
    unknown: ["status--unknown", "нет данных"],
  };
  const [cls, label] = map[state] || map.unknown;
  return `<span class="status ${cls}"><span class="status__dot"></span>${label}</span>`;
}

function renderServers(site, status) {
  const host = document.querySelector("[data-servers]");
  if (!host || !site) return;

  const byId = {};
  (status?.servers || []).forEach((s) => {
    byId[s.id] = s;
  });

  host.innerHTML = site.servers
    .map((cfg) => {
      const live = byId[cfg.id];
      // online === null означает «опросить не удалось», это не то же самое, что офлайн.
      let state = "unknown";
      if (live && live.online === true) state = "online";
      else if (live && live.online === false) state = "offline";
      const players = live?.players ?? 0;
      const max = live?.max ?? 0;
      const pct = max > 0 ? Math.min(100, (players / max) * 100) : 0;

      const meta = [];
      if (live?.version) meta.push(`<span>версия <b>${live.version}</b></span>`);
      else if (cfg.version) meta.push(`<span>версия <b>${cfg.version}</b></span>`);
      if (live?.map) meta.push(`<span>карта <b>${live.map}</b></span>`);
      if (state === "unknown" && live?.note) meta.push(`<span>${live.note}</span>`);

      return `
        <article class="server">
          <div class="server__head">
            <div>
              <div class="server__game">${cfg.game}</div>
              <h3 class="mt-0">${cfg.name}</h3>
            </div>
            ${statusBlock(state)}
          </div>

          <div class="players">${players}<small> / ${max || "?"} игроков</small></div>
          <div class="bar"><div class="bar__fill" style="width:${pct}%"></div></div>

          ${copyButton(cfg.address)}
          <p class="small dim" style="margin-top:0.9rem">${cfg.connect_hint}</p>
          ${meta.length ? `<div class="meta-row">${meta.join("")}</div>` : ""}
        </article>`;
    })
    .join("");

  const stamp = document.querySelector("[data-updated]");
  if (stamp) {
    stamp.textContent = status?.updated
      ? `данные обновлены ${timeAgo(status.updated)}`
      : "мониторинг ещё не запускался — данные появятся после первого запуска GitHub Actions";
  }
}

/* ── Состав администрации ──────────────────────────────── */

function renderStaff(site) {
  const host = document.querySelector("[data-staff]");
  if (!host || !site?.staff) return;

  host.innerHTML = site.staff
    .map(
      (tier, i) => `
      <div class="tier">
        <div class="tier__name" data-level="${String(i + 1).padStart(2, "0")}">${tier.tier}</div>
        <p class="small dim" style="margin:0">${tier.note}</p>
        <div class="chips">${tier.roles.map((r) => `<span class="chip">${r}</span>`).join("")}</div>
      </div>`
    )
    .join("");
}

/* ── Донат ─────────────────────────────────────────────── */

function renderDonate(site) {
  const host = document.querySelector("[data-donate]");
  if (!host || !site?.donate) return;

  host.innerHTML = site.donate.tiers
    .map(
      (tier) => `
      <article class="card card--accent">
        <h3>${tier.name}</h3>
        <div class="price">${tier.price}</div>
        <ul>${tier.perks.map((p) => `<li>${p}</li>`).join("")}</ul>
      </article>`
    )
    .join("");

  const links = document.querySelector("[data-donate-links]");
  if (links) {
    const ready = site.donate.links.filter((l) => !l.url.includes("ЗАМЕНИ"));
    links.innerHTML = ready.length
      ? ready
          .map((l) => `<a class="btn btn--primary" href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`)
          .join("")
      : `<p class="small dim mono">Ссылки для доната не заданы — впиши их в data/site.json</p>`;
  }

  const disc = document.querySelector("[data-donate-disclaimer]");
  if (disc) disc.textContent = site.donate.disclaimer;
}

/* ── Заявки ────────────────────────────────────────────── */

function renderApplications(site) {
  const host = document.querySelector("[data-applications]");
  if (!host || !site?.applications) return;

  const invite = site.project.discord_invite;
  const linkReady = invite && !invite.includes("ЗАМЕНИ");

  host.innerHTML = site.applications
    .map(
      (app) => `
      <article class="card">
        <h3>${app.title}</h3>
        <p class="small dim">${app.desc}</p>
        <ul>${app.requirements.map((r) => `<li>${r}</li>`).join("")}</ul>
        <p style="margin:1.1rem 0 0">
          ${
            linkReady
              ? `<a class="btn" href="${invite}" target="_blank" rel="noopener">Открыть #${app.channel}</a>`
              : `<span class="mono small dim">канал #${app.channel} в Discord</span>`
          }
        </p>
      </article>`
    )
    .join("");
}

/* ── Копирование адреса ────────────────────────────────── */

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-copy]");
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    const was = btn.textContent;
    btn.textContent = "скопировано";
    setTimeout(() => {
      btn.textContent = was;
    }, 1600);
  } catch {
    btn.textContent = "не вышло";
  }
});

/* ── Старт ─────────────────────────────────────────────── */

(async function init() {
  markCurrentPage();
  const [site, status] = await Promise.all([loadJSON(DATA), loadJSON(STATUS)]);
  if (!site) {
    console.error("data/site.json не загружен — страница останется без данных");
    return;
  }
  applyDiscordLinks(site);
  renderServers(site, status);
  renderStaff(site);
  renderDonate(site);
  renderApplications(site);
})();
