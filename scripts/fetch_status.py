"""Собирает статус игровых серверов в data/status.json.

Запускается GitHub Actions по расписанию, а не в браузере: ключ API SCP:SL
секретный, и в клиентский JS его класть нельзя. Готовый JSON сайт читает
как обычный статический файл.

Только стандартная библиотека — в CI не нужен pip install.

    python scripts/fetch_status.py
    SCPSL_API_KEY=xxx python scripts/fetch_status.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "data" / "site.json"
OUT = ROOT / "data" / "status.json"
TIMEOUT = 12
UA = "ApocalypseSite/1.0 (+https://github.com)"


def get_json(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        print(f"  HTTP {exc.code} от {urllib.parse.urlparse(url).netloc}")
    except urllib.error.URLError as exc:
        print(f"  сеть недоступна: {exc.reason}")
    except (ValueError, TimeoutError) as exc:
        print(f"  некорректный ответ: {exc}")
    return None


def placeholder(cfg: dict, reason: str) -> dict:
    print(f"  нет данных: {reason}")
    return {
        "id": cfg["id"],
        "name": cfg["name"],
        "online": None,
        "players": 0,
        "max": 0,
        "note": reason,
    }


def fetch_minecraft(cfg: dict) -> dict:
    address = cfg.get("address", "")
    if not address or "ЗАМЕНИ" in address:
        return placeholder(cfg, "адрес не задан в data/site.json")

    data = get_json(f"https://api.mcsrvstat.us/3/{urllib.parse.quote(address)}")
    if data is None:
        return placeholder(cfg, "сервис mcsrvstat.us не ответил")

    online = bool(data.get("online"))
    players = data.get("players") or {}
    version = data.get("version")
    return {
        "id": cfg["id"],
        "name": cfg["name"],
        "online": online,
        "players": int(players.get("online", 0) or 0),
        "max": int(players.get("max", 0) or 0),
        "version": version if isinstance(version, str) else cfg.get("version"),
    }


def fetch_scpsl(cfg: dict) -> dict:
    account_id = str(cfg.get("scpsl_account_id", ""))
    api_key = os.environ.get("SCPSL_API_KEY", "")

    if not account_id or "ЗАМЕНИ" in account_id:
        return placeholder(cfg, "не задан scpsl_account_id в data/site.json")
    if not api_key:
        return placeholder(cfg, "не задан секрет SCPSL_API_KEY")

    query = urllib.parse.urlencode(
        {"id": account_id, "key": api_key, "players": "true", "info": "true"}
    )
    data = get_json(f"https://api.scpslgame.com/serverinfo.php?{query}")
    if data is None:
        return placeholder(cfg, "API SCP:SL не ответил")
    if not data.get("Success"):
        return placeholder(cfg, f"API вернул ошибку: {data.get('Error', 'без описания')}")

    servers = data.get("Servers") or []
    if not servers:
        return placeholder(cfg, "у аккаунта нет зарегистрированных серверов")

    srv = servers[0]
    # Поле Players приходит строкой вида "3/30" (иногда с хвостом).
    players = max_players = 0
    raw = str(srv.get("Players", ""))
    if "/" in raw:
        left, _, right = raw.partition("/")
        players = int("".join(ch for ch in left if ch.isdigit()) or 0)
        max_players = int("".join(ch for ch in right if ch.isdigit()) or 0)

    return {
        "id": cfg["id"],
        "name": cfg["name"],
        "online": bool(srv.get("Online", True)),
        "players": players,
        "max": max_players,
        "version": srv.get("Version"),
    }


FETCHERS = {"minecraft": fetch_minecraft, "scpsl": fetch_scpsl}


def main() -> int:
    if not SITE.exists():
        print(f"нет файла {SITE}", file=sys.stderr)
        return 1

    site = json.loads(SITE.read_text(encoding="utf-8"))
    results = []

    for cfg in site.get("servers", []):
        print(f"[{cfg['id']}] {cfg['name']}")
        fetcher = FETCHERS.get(cfg["id"])
        if fetcher is None:
            results.append(placeholder(cfg, f"нет обработчика для id '{cfg['id']}'"))
            continue
        entry = fetcher(cfg)
        results.append(entry)
        if entry.get("online"):
            print(f"  онлайн: {entry['players']}/{entry['max']}")
        elif entry.get("online") is False:
            print("  офлайн")

    payload = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "servers": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nзаписан {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
