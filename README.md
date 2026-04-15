# Supply Pack Analyzer

A [Torn City](https://www.torn.com) userscript that tells you **whether your supply packs are actually paying off**. It scans your Torn log for every pack you've ever opened and purchased, pulls live market prices, and shows per-pack drop rates, expected value, and ROI.

Install: **[Greasy Fork — Supply Pack Analyzer](https://greasyfork.org/scripts/573251)**  (Tampermonkey / Violentmonkey / Greasemonkey)

---

## What it does

Supply packs (Xanax packs, booster packs, Christmas sock, etc.) are random drops. Torn tells you what you *got* but not whether what you got was *worth the price*. This script:

1. **Syncs your log** via the Torn v2 API — walks log-type IDs for pack **openings** (`2330, 2350, …, 4001`) and pack **purchases** (`1112, 1225`), writes them into an IndexedDB store in your browser.
2. **Values every drop** by pulling the current item market price (`/market/{id}`) and pricing each pack's contents.
3. **Tracks everything locally** — all data stays in your browser. No backend, no account, no sharing.

Once the first sync is done (typically a couple of minutes for a full history — rate-limited to one Torn call every ~750 ms), the panel shows the numbers.

---

## Panel

Injected as a floating panel on `torn.com`. Three tabs:

| Tab | Content |
|---|---|
| **Dashboard** | Per-pack summary: openings, buys, total spent, total value, profit/loss, ROI %, average value/open. Click a row → Pack Detail. |
| **Pack Detail** | One pack's breakdown: drop-rate table (item · count · % · avg value), full opening history with timestamps, price-history chart for the pack's contents. |
| **Settings** | API key management (Torn public key required), manual re-sync, DB reset, export/import JSON backup. |

---

## How it works under the hood

- **Storage**: IndexedDB (`spa_db`), 4 object stores — `openings`, `purchases`, `items`, `priceHistory`. Survives browser restarts.
- **Torn API**: `@grant none` — all calls go directly from your browser. One request every 750 ms (Torn allows 100/min; we use ~80). Log IDs are fetched in chunks of ≤10 (Torn silently returns 0 results for larger chunks).
- **Pricing**: each distinct item encountered in a drop or purchase gets a market price fetch; prices are cached per item with a `priceHistory` trail so you can see drift over time.
- **No backend**: deliberately. This is a personal log analyzer — your key and your data never leave your browser.

---

## Privacy

- Your Torn API key is stored in `localStorage` under `spa_apiKey` and used only for direct requests to `api.torn.com`.
- Pack history, purchases, and item prices are stored in your browser's IndexedDB.
- Nothing is uploaded anywhere. There is no server. If you want to move data between browsers, use the **Export JSON** button in Settings.
- Uninstalling the script doesn't wipe the data — use **Reset DB** in Settings first if you want a clean removal.

---

## Install

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Edge/Firefox/Safari) or [Violentmonkey](https://violentmonkey.github.io/).
2. Install the script from **[Greasy Fork](https://greasyfork.org/scripts/573251)** — you'll get auto-updates via the `@updateURL` in the script header.
3. Open `torn.com` and find the Supply Pack Analyzer panel. Paste your **public** Torn API key in Settings.
4. Click **Sync** once — first run back-fills your full log. Subsequent syncs are incremental.

---

## Development

The whole thing is one file: [`supply-pack-analyzer.user.js`](supply-pack-analyzer.user.js). To hack on it locally:

1. In Tampermonkey, create a new script and point it at a `file://` URL of your local copy (or paste the contents directly).
2. Edit, save, reload `torn.com`.

The file is organized as top-to-bottom sections marked with `════` banners: constants → utils → `Database` (IndexedDB wrapper) → `TornAPI` (rate-limited client) → `LogParser` → `Analyzer` (drop rates + EV math) → `SyncManager` → `UI`.

Releases are published on [Greasy Fork](https://greasyfork.org/scripts/573251) by bumping `@version` in the script header.

---

## License

MIT — see the license line in the script header.
