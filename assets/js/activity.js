/* Discord Activity: компактная панель статуса серверов.
 *
 * Внутри Discord страница живёт в iframe на <client_id>.discordsays.com,
 * и весь трафик идёт через прокси Discord. Поэтому здесь нет обращений
 * к внешним API: data/status.json лежит на том же origin и собирается
 * заранее через GitHub Actions. Относительные пути прокси разрешает,
 * сторонние домены без URL Mapping блокируются по CSP.
 */

// Пакет не собран в один файл: index.mjs тянет соседние модули относительными
// путями, поэтому в vendor/ копируется вся папка output целиком.
const SDK_PATH = "./vendor/embedded-app-sdk/index.mjs";
const REFRESH_MS = 60_000;

let siteData = null;

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/* Discord подставляет frame_id в query при запуске активности. */
function insideDiscord() {
  const params = new URLSearchParams(location.search);
  return params.has("frame_id") || location.hostname.endsWith("discordsays.com");
}

function note(text) {
  const el = document.querySelector("[data-sdk-note]");
  if (el) el.textContent = text;
}

/* ── Подключение к Discord ─────────────────────────────── */

async function connectDiscord(clientId) {
  if (!insideDiscord()) {
    note("Открыто вне Discord — панель работает в обычном режиме.");
    return null;
  }
  if (!clientId || clientId.includes("ЗАМЕНИ")) {
    note("Не задан discord_client_id в data/site.json — SDK не запущен.");
    return null;
  }

  let DiscordSDK;
  try {
    ({ DiscordSDK } = await import(SDK_PATH));
  } catch {
    note(
      "Не найден assets/js/vendor/embedded-app-sdk/ — скопируй туда SDK, см. README."
    );
    return null;
  }

  try {
    const sdk = new DiscordSDK(clientId);
    // Пока не вызвать ready(), Discord держит экран загрузки.
    await sdk.ready();
    note(`Активность запущена · канал ${sdk.channelId ?? "—"}`);
    return sdk;
  } catch (err) {
    note(`SDK не стартовал: ${err.message}`);
    return null;
  }
}

/* ── Отрисовка ─────────────────────────────────────────── */

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(diff)) return "неизвестно когда";
  if (diff < 90) return "только что";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours} ч назад` : `${Math.floor(hours / 24)} дн назад`;
}

function stateOf(live) {
  if (live && live.online === true) return "online";
  if (live && live.online === false) return "offline";
  return "unknown";
}

const LABELS = {
  online: ["status--online", "онлайн"],
  offline: ["status--offline", "офлайн"],
  unknown: ["status--unknown", "нет данных"],
};

function render(status) {
  const host = document.querySelector("[data-servers]");
  if (!host || !siteData) return;

  const byId = {};
  (status?.servers || []).forEach((s) => {
    byId[s.id] = s;
  });

  host.innerHTML = siteData.servers
    .map((cfg) => {
      const live = byId[cfg.id];
      const state = stateOf(live);
      const [cls, label] = LABELS[state];
      const players = live?.players ?? 0;
      const max = live?.max ?? 0;
      const pct = max > 0 ? Math.min(100, (players / max) * 100) : 0;
      const hasAddress = cfg.address && !cfg.address.includes("ЗАМЕНИ");

      return `
        <article class="act-card">
          <div class="act-card__top">
            <div class="act-card__name">${cfg.name}</div>
            <span class="status ${cls}"><span class="status__dot"></span>${label}</span>
          </div>
          <div class="act-card__players">${players}<small> / ${max || "?"}</small></div>
          <div class="bar"><div class="bar__fill" style="width:${pct}%"></div></div>
          ${
            hasAddress
              ? `<div class="address">
                   <code>${cfg.address}</code>
                   <button type="button" data-copy="${cfg.address}">копировать</button>
                 </div>`
              : `<p class="act-card__note">адрес не указан</p>`
          }
          ${state === "unknown" && live?.note ? `<p class="act-card__note">${live.note}</p>` : ""}
        </article>`;
    })
    .join("");

  const stamp = document.querySelector("[data-updated]");
  if (stamp) {
    stamp.textContent = status?.updated ? `обновлено ${timeAgo(status.updated)}` : "";
  }
}

async function refresh() {
  const btn = document.querySelector("[data-refresh]");
  if (btn) btn.disabled = true;
  try {
    render(await loadJSON("data/status.json"));
  } catch (err) {
    console.warn("статус не загрузился:", err.message);
    render(null);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* Копирование адреса */
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-copy]");
  if (btn) {
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
    return;
  }
  if (e.target.closest("[data-refresh]")) refresh();
});

/* ── Старт ─────────────────────────────────────────────── */

(async function init() {
  try {
    siteData = await loadJSON("data/site.json");
  } catch (err) {
    note(`data/site.json не загружен: ${err.message}`);
    return;
  }

  await connectDiscord(siteData.project?.discord_client_id);
  await refresh();

  // Активность висит в войсе подолгу — обновляем статус сами.
  setInterval(refresh, REFRESH_MS);
})();
