// ==UserScript==
// @name         Supply Pack Analyzer
// @namespace    https://github.com/eugene-torn-scripts/supply-pack-analyzer
// @version      2.1.3
// @description  Analyze supply pack profitability in Torn City — tracks openings, purchases, drop rates, and EV via API sync.
// @author       lannav
// @match        https://www.torn.com/*
// @grant        none
// @license      GPL-3.0-or-later
// @downloadURL  https://update.greasyfork.org/scripts/573251/Supply%20Pack%20Analyzer.user.js
// @updateURL    https://update.greasyfork.org/scripts/573251/Supply%20Pack%20Analyzer.meta.js
// ==/UserScript==

/*
 * Supply Pack Analyzer
 * Copyright (C) 2026 lannav
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details: https://www.gnu.org/licenses/gpl-3.0.html
 *
 * Source: https://github.com/eugene-torn-scripts/supply-pack-analyzer
 */

(function () {
    "use strict";

    // ════════════════════════════════════════════════════════════
    //  CONSTANTS & CONFIG
    // ════════════════════════════════════════════════════════════

    const VERSION = "2.1.3";
    const DB_NAME = "spa_db";
    const DB_VERSION = 1;
    const LS = (k) => "spa_" + k;

    const API_BASE = "https://api.torn.com/v2";
    const API_DELAY = 750;
    const API_PAGE_LIMIT = 100;
    const API_MAX_LOG_IDS = 10; // Torn API silently returns 0 results if >10 log IDs

    // Log‑type IDs that represent opening/using a supply pack
    // Split into chunks of 10 for API calls
    const OPEN_LOG_IDS = [
        2330, 2350, 2360, 2370, 2390, 2400, 2405, 2406, 2407, 2480, 2500,
        2510, 2520, 2525, 2605, 2615, 4001,
    ];
    // Log‑type IDs for purchases (we filter to supply‑pack items client‑side)
    const BUY_LOG_IDS = [1112, 1225];

    // ════════════════════════════════════════════════════════════
    //  UTILITIES
    // ════════════════════════════════════════════════════════════

    const fmt = {
        money(n) {
            if (n == null) return "$0";
            const abs = Math.abs(n);
            const s = abs >= 1e9 ? (abs / 1e9).toFixed(2) + "B"
                : abs >= 1e6 ? (abs / 1e6).toFixed(2) + "M"
                : abs >= 1e3 ? (abs / 1e3).toFixed(1) + "K"
                : abs.toLocaleString();
            return (n < 0 ? "-$" : "$") + s;
        },
        moneyFull(n) {
            return (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString();
        },
        pct(n) {
            return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
        },
        num(n) {
            return n.toLocaleString();
        },
        date(ts) {
            const d = new Date(ts * 1000);
            return d.toLocaleDateString() + " " + d.toLocaleTimeString();
        },
        shortDate(ts) {
            const d = new Date(ts * 1000);
            return d.toLocaleDateString();
        },
    };

    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

    // ════════════════════════════════════════════════════════════
    //  INDEXED-DB WRAPPER
    // ════════════════════════════════════════════════════════════

    class Database {
        constructor() { this.db = null; }

        open() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains("openings")) {
                        const s = db.createObjectStore("openings", { keyPath: "id" });
                        s.createIndex("timestamp", "timestamp");
                        s.createIndex("packItemId", "packItemId");
                    }
                    if (!db.objectStoreNames.contains("purchases")) {
                        const s = db.createObjectStore("purchases", { keyPath: "id" });
                        s.createIndex("timestamp", "timestamp");
                        s.createIndex("packItemId", "packItemId");
                    }
                    if (!db.objectStoreNames.contains("items")) {
                        const s = db.createObjectStore("items", { keyPath: "id" });
                        s.createIndex("type", "type");
                        s.createIndex("name", "name");
                    }
                    if (!db.objectStoreNames.contains("priceHistory")) {
                        const s = db.createObjectStore("priceHistory", { autoIncrement: true });
                        s.createIndex("itemId", "itemId");
                        s.createIndex("timestamp", "timestamp");
                    }
                };
                req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
                req.onerror = (e) => reject(e.target.error);
            });
        }

        _tx(store, mode) {
            const tx = this.db.transaction(store, mode);
            return tx.objectStore(store);
        }

        put(store, data) {
            return new Promise((resolve, reject) => {
                const r = this._tx(store, "readwrite").put(data);
                r.onsuccess = () => resolve();
                r.onerror = (e) => reject(e.target.error);
            });
        }

        putBatch(store, items) {
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction(store, "readwrite");
                const s = tx.objectStore(store);
                for (const item of items) s.put(item);
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e.target.error);
            });
        }

        get(store, key) {
            return new Promise((resolve, reject) => {
                const r = this._tx(store, "readonly").get(key);
                r.onsuccess = () => resolve(r.result);
                r.onerror = (e) => reject(e.target.error);
            });
        }

        getAll(store) {
            return new Promise((resolve, reject) => {
                const r = this._tx(store, "readonly").getAll();
                r.onsuccess = () => resolve(r.result);
                r.onerror = (e) => reject(e.target.error);
            });
        }

        getAllByIndex(store, indexName, range) {
            return new Promise((resolve, reject) => {
                const r = this._tx(store, "readonly").index(indexName).getAll(range);
                r.onsuccess = () => resolve(r.result);
                r.onerror = (e) => reject(e.target.error);
            });
        }

        count(store) {
            return new Promise((resolve, reject) => {
                const r = this._tx(store, "readonly").count();
                r.onsuccess = () => resolve(r.result);
                r.onerror = (e) => reject(e.target.error);
            });
        }

        clear(store) {
            return new Promise((resolve, reject) => {
                const r = this._tx(store, "readwrite").clear();
                r.onsuccess = () => resolve();
                r.onerror = (e) => reject(e.target.error);
            });
        }

        /** Iterate cursor, calling fn(value) for each record. Memory‑efficient. */
        iterate(store, indexName, range, fn) {
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction(store, "readonly");
                const idx = tx.objectStore(store).index(indexName);
                const req = idx.openCursor(range);
                req.onsuccess = (e) => {
                    const c = e.target.result;
                    if (c) { fn(c.value); c.continue(); }
                };
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e.target.error);
            });
        }
    }

    // ════════════════════════════════════════════════════════════
    //  API CLIENT
    // ════════════════════════════════════════════════════════════

    class TornAPI {
        constructor() {
            this.apiKey = localStorage.getItem(LS("apiKey")) || "";
            this._lastReq = 0;
        }

        async _rateLimit() {
            const now = Date.now();
            const wait = API_DELAY - (now - this._lastReq);
            if (wait > 0) await sleep(wait);
            this._lastReq = Date.now();
        }

        async _fetch(url) {
            await this._rateLimit();
            const sep = url.includes("?") ? "&" : "?";
            const res = await fetch(url + sep + "key=" + this.apiKey);
            const data = await res.json();
            if (data.error) throw new Error(data.error.error);
            return data;
        }

        async fetchEndpoint(path, params = {}) {
            const url = new URL(API_BASE + path);
            for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
            return this._fetch(url.toString());
        }

        async validate(key) {
            const res = await fetch(
                `${API_BASE}/user/?selections=basic&key=${key}`
            );
            return res.json();
        }

        async fetchSupplyPacks() {
            return this.fetchEndpoint("/torn/items", { cat: "Supply Pack" });
        }

        async fetchItemsByIds(ids) {
            return this.fetchEndpoint(`/torn/${ids.join(",")}/items`);
        }

        async fetchAllItems() {
            return this.fetchEndpoint("/torn/items");
        }

        /**
         * Paginate through user logs for given log‑type IDs.
         * Torn API caps at 10 log IDs per request, so we chunk automatically.
         * Uses sort=desc and follows `prev` links for full pagination.
         * `fromTs` filters to entries with timestamp > fromTs (incremental sync).
         */
        async fetchLogs(logIds, fromTs, onBatch, onProgress, signal) {
            let total = 0;
            const chunks = [];
            for (let i = 0; i < logIds.length; i += API_MAX_LOG_IDS)
                chunks.push(logIds.slice(i, i + API_MAX_LOG_IDS));

            for (let ci = 0; ci < chunks.length; ci++) {
                const logParam = chunks[ci].join(",");
                let url =
                    `${API_BASE}/user/log?log=${logParam}&limit=${API_PAGE_LIMIT}&sort=desc` +
                    (fromTs ? `&from=${fromTs}` : "");
                while (url) {
                    if (signal && signal.aborted) return total;
                    const data = await this._fetch(url);
                    const logs = data.log || [];
                    if (!logs.length) break; // No results — stop paginating this chunk
                    await onBatch(logs);
                    total += logs.length;
                    if (onProgress) onProgress(total, ci + 1, chunks.length);
                    const prev = data._metadata?.links?.prev;
                    url = prev || null;
                }
            }
            return total;
        }
    }

    // ════════════════════════════════════════════════════════════
    //  LOG PARSER
    // ════════════════════════════════════════════════════════════

    class LogParser {
        constructor() {
            this.supplyPackIds = new Set();
            this.supplyPackNameToId = new Map();
            this.itemNameToId = new Map();
            this.itemIdToName = new Map();
        }

        loadItems(itemsArr) {
            for (const it of itemsArr) {
                this.itemNameToId.set(it.name, it.id);
                this.itemIdToName.set(it.id, it.name);
                if (it.type === "Supply Pack") {
                    this.supplyPackIds.add(it.id);
                    this.supplyPackNameToId.set(it.name, it.id);
                }
            }
        }

        // ── API log parsing ───────────────────────────────────

        parseAPIOpening(log) {
            const packId = log.data?.item;
            if (!packId) return null;
            const items = (log.data?.items || []).map((i) => ({
                itemId: i.id,
                name: this.itemIdToName.get(i.id) || `Item #${i.id}`,
                qty: i.qty || 1,
            }));
            return {
                id: log.id,
                timestamp: log.timestamp,
                packItemId: packId,
                packName: this.itemIdToName.get(packId) || `Pack #${packId}`,
                items,
                money: log.data?.money || 0,
                source: "api",
            };
        }

        parseAPIPurchase(log) {
            const logItems = log.data?.items || [];
            if (!logItems.length) return null;
            const item = logItems[0];
            if (!this.supplyPackIds.has(item.id)) return null;
            const channel = log.details?.id === 1112 ? "itemmarket" : "bazaar";
            return {
                id: log.id,
                timestamp: log.timestamp,
                packItemId: item.id,
                packName: this.itemIdToName.get(item.id) || `Pack #${item.id}`,
                qty: item.qty || 1,
                costEach: log.data?.cost_each || 0,
                costTotal: log.data?.cost_total || 0,
                channel,
                source: "api",
            };
        }

    }

    // ════════════════════════════════════════════════════════════
    //  ANALYZER
    // ════════════════════════════════════════════════════════════

    class Analyzer {
        constructor(db) { this.db = db; this._itemPriceCache = {}; }

        async _loadPrices() {
            const all = await this.db.getAll("items");
            this._itemPriceCache = {};
            for (const it of all) this._itemPriceCache[it.id] = it;
        }

        _price(itemId) {
            const it = this._itemPriceCache[itemId];
            return it?.marketPrice || 0;
        }

        _valueOpening(o) {
            let v = o.money || 0;
            for (const it of o.items) v += this._price(it.itemId) * it.qty;
            return v;
        }

        async getOverview(from, to) {
            await this._loadPrices();
            const range = (from || to)
                ? IDBKeyRange.bound(from || 0, to || 9999999999)
                : null;

            const packs = {};
            const addPack = (id, name) => {
                if (!packs[id]) packs[id] = {
                    packItemId: id, packName: name,
                    opened: 0, purchased: 0,
                    totalPurchaseCost: 0, // raw sum of all purchase costs
                    totalSpent: 0,        // cost attributed to opened packs only
                    totalValue: 0, totalMoney: 0,
                    itemsReceived: {},
                };
                return packs[id];
            };

            // Openings
            const openings = range
                ? await this.db.getAllByIndex("openings", "timestamp", range)
                : await this.db.getAll("openings");
            for (const o of openings) {
                const p = addPack(o.packItemId, o.packName);
                p.opened++;
                const val = this._valueOpening(o);
                p.totalValue += val;
                p.totalMoney += o.money || 0;
                for (const it of o.items) {
                    const key = it.itemId || it.name;
                    if (!p.itemsReceived[key])
                        p.itemsReceived[key] = { itemId: it.itemId, name: it.name, qty: 0, drops: 0 };
                    p.itemsReceived[key].qty += it.qty;
                    p.itemsReceived[key].drops++;
                }
            }

            // Purchases — compute avg buy price, then attribute cost only to opened packs
            const purchases = range
                ? await this.db.getAllByIndex("purchases", "timestamp", range)
                : await this.db.getAll("purchases");
            for (const p of purchases) {
                const pk = addPack(p.packItemId, p.packName);
                pk.purchased += p.qty;
                pk.totalPurchaseCost += p.costTotal;
            }

            // Cost-per-opened: spent = opened × avg_buy_price
            // All opened packs valued at avg buy price, even if obtained via trades/gifts
            for (const p of Object.values(packs)) {
                const avgBuyPrice = p.purchased > 0 ? p.totalPurchaseCost / p.purchased : 0;
                p.avgBuyPrice = avgBuyPrice;
                p.totalSpent = p.opened * avgBuyPrice;
            }

            // Totals
            let totalSpent = 0, totalValue = 0, totalOpened = 0, totalPurchased = 0;
            for (const p of Object.values(packs)) {
                totalSpent += p.totalSpent;
                totalValue += p.totalValue;
                totalOpened += p.opened;
                totalPurchased += p.purchased;
            }

            return {
                packs, totalSpent, totalValue, totalOpened, totalPurchased,
                pnl: totalValue - totalSpent,
                roi: totalSpent > 0 ? ((totalValue - totalSpent) / totalSpent) * 100 : 0,
                valuePerPack: totalOpened > 0 ? totalValue / totalOpened : 0,
            };
        }

        async getDropRates(packItemId, from, to) {
            await this._loadPrices();
            const allOpenings = from || to
                ? await this.db.getAllByIndex("openings", "timestamp",
                    IDBKeyRange.bound(from || 0, to || 9999999999))
                : await this.db.getAll("openings");
            const openings = packItemId
                ? allOpenings.filter((o) => o.packItemId === packItemId)
                : allOpenings;

            const total = openings.length;
            const items = {};
            let totalMoney = 0;
            let moneyDrops = 0;
            for (const o of openings) {
                if (o.money) { totalMoney += o.money; moneyDrops++; }
                for (const it of o.items) {
                    const key = it.itemId || it.name;
                    if (!items[key]) items[key] = { itemId: it.itemId, name: it.name, totalQty: 0, drops: 0 };
                    items[key].totalQty += it.qty;
                    items[key].drops++;
                }
            }

            const rates = Object.values(items).map((it) => ({
                ...it,
                dropRate: total > 0 ? (it.drops / total) * 100 : 0,
                avgQtyPerDrop: it.drops > 0 ? it.totalQty / it.drops : 0,
                avgQtyPerOpen: total > 0 ? it.totalQty / total : 0,
                unitPrice: this._price(it.itemId),
                valueContribution: total > 0
                    ? (this._price(it.itemId) * it.totalQty) / total : 0,
            }));

            // Add cash as a virtual drop item
            if (totalMoney > 0) {
                rates.unshift({
                    itemId: null, name: "Cash",
                    totalQty: totalMoney, drops: moneyDrops,
                    dropRate: total > 0 ? (moneyDrops / total) * 100 : 0,
                    avgQtyPerDrop: moneyDrops > 0 ? totalMoney / moneyDrops : 0,
                    avgQtyPerOpen: total > 0 ? totalMoney / total : 0,
                    unitPrice: 1,
                    valueContribution: total > 0 ? totalMoney / total : 0,
                });
            }

            return { total, rates };
        }

        async getEV(packItemId) {
            await this._loadPrices();
            const openings = packItemId
                ? await this.db.getAllByIndex("openings", "packItemId", IDBKeyRange.only(packItemId))
                : await this.db.getAll("openings");
            if (!openings.length) return null;

            let totalVal = 0;
            for (const o of openings) totalVal += this._valueOpening(o);
            const avgReturn = totalVal / openings.length;

            const purchases = await this.db.getAll("purchases");
            let totalCost = 0, totalQty = 0;
            for (const p of purchases) {
                if (packItemId && p.packItemId !== packItemId) continue;
                totalCost += p.costTotal; totalQty += p.qty;
            }
            const avgCost = totalQty > 0 ? totalCost / totalQty : 0;

            return {
                avgReturn,
                avgCost,
                ev: avgReturn - avgCost,
                breakEven: avgReturn,
                sampleSize: openings.length,
            };
        }

        async getBestSources(packItemId, from, to) {
            const purchases = from || to
                ? await this.db.getAllByIndex("purchases", "timestamp",
                    IDBKeyRange.bound(from || 0, to || 9999999999))
                : await this.db.getAll("purchases");
            const filtered = packItemId
                ? purchases.filter((p) => p.packItemId === packItemId)
                : purchases;

            const sources = {};
            for (const p of filtered) {
                const ch = p.channel || "unknown";
                if (!sources[ch]) sources[ch] = { channel: ch, totalCost: 0, totalQty: 0 };
                sources[ch].totalCost += p.costTotal;
                sources[ch].totalQty += p.qty;
            }
            return Object.values(sources).map((s) => ({
                ...s, avgCost: s.totalQty > 0 ? s.totalCost / s.totalQty : 0,
            })).sort((a, b) => a.avgCost - b.avgCost);
        }

        async getPriceTrends() {
            const history = await this.db.getAll("priceHistory");
            const byItem = {};
            for (const h of history) {
                if (!byItem[h.itemId]) byItem[h.itemId] = [];
                byItem[h.itemId].push(h);
            }
            for (const k of Object.keys(byItem)) {
                byItem[k].sort((a, b) => a.timestamp - b.timestamp);
            }
            return byItem;
        }
    }

    // ════════════════════════════════════════════════════════════
    //  SYNC MANAGER
    // ════════════════════════════════════════════════════════════

    class SyncManager {
        constructor(db, api, parser) {
            this.db = db;
            this.api = api;
            this.parser = parser;
            this.syncing = false;
            this.abortController = null;
            this.onProgress = null;
        }

        async sync() {
            if (this.syncing) return;
            this.syncing = true;
            this.abortController = new AbortController();
            const errors = [];
            let openCount = 0, buyCount = 0;
            try {
                // 1. Fetch supply pack definitions + all items
                if (this.onProgress) this.onProgress("Fetching item database...");
                await this._syncItems();

                // 2. Fetch opening logs
                try {
                    if (this.onProgress) this.onProgress("Fetching opening logs...");
                    let openMaxTs = +(localStorage.getItem(LS("lastOpenSync")) || 0);
                    openCount = await this.api.fetchLogs(
                        OPEN_LOG_IDS, openMaxTs || null,
                        async (logs) => {
                            const parsed = logs
                                .map((l) => this.parser.parseAPIOpening(l))
                                .filter(Boolean);
                            if (parsed.length) await this.db.putBatch("openings", parsed);
                            // Track the NEWEST timestamp across all batches
                            for (const l of logs) {
                                if (l.timestamp > openMaxTs) openMaxTs = l.timestamp;
                            }
                        },
                        (n, ci, ct) => { if (this.onProgress) this.onProgress(`Fetching openings... ${fmt.num(n)} logs (batch ${ci}/${ct})`); },
                        this.abortController.signal
                    );
                    if (openMaxTs > 0) localStorage.setItem(LS("lastOpenSync"), openMaxTs + 1);
                } catch (e) {
                    errors.push("Openings: " + e.message);
                    console.error("SPA opening sync error:", e);
                }

                // 3. Fetch purchase logs
                try {
                    if (this.onProgress) this.onProgress("Fetching purchase logs...");
                    let buyMaxTs = +(localStorage.getItem(LS("lastBuySync")) || 0);
                    buyCount = await this.api.fetchLogs(
                        BUY_LOG_IDS, buyMaxTs || null,
                        async (logs) => {
                            const parsed = logs
                                .map((l) => this.parser.parseAPIPurchase(l))
                                .filter(Boolean);
                            if (parsed.length) await this.db.putBatch("purchases", parsed);
                            for (const l of logs) {
                                if (l.timestamp > buyMaxTs) buyMaxTs = l.timestamp;
                            }
                        },
                        (n, ci, ct) => { if (this.onProgress) this.onProgress(`Fetching purchases... ${fmt.num(n)} logs (batch ${ci}/${ct})`); },
                        this.abortController.signal
                    );
                    if (buyMaxTs > 0) localStorage.setItem(LS("lastBuySync"), buyMaxTs + 1);
                } catch (e) {
                    errors.push("Purchases: " + e.message);
                    console.error("SPA purchase sync error:", e);
                }

                // 4. Refresh prices for items found in drops
                try {
                    if (this.onProgress) this.onProgress("Updating item prices...");
                    await this._refreshDropPrices();
                } catch (e) {
                    errors.push("Prices: " + e.message);
                    console.error("SPA price refresh error:", e);
                }

                // 5. Save price history snapshot
                try { await this._savePriceSnapshot(); } catch (e) { /* non-critical */ }

                localStorage.setItem(LS("lastSync"), Date.now());
                const msg = `Sync done. ${fmt.num(openCount)} opening logs, ${fmt.num(buyCount)} purchase logs.`;
                if (this.onProgress) this.onProgress(errors.length ? msg + " Errors: " + errors.join("; ") : msg);
            } catch (e) {
                // Only reaches here if _syncItems fails
                localStorage.setItem(LS("lastSync"), Date.now());
                if (this.onProgress) this.onProgress("Sync error: " + e.message);
                console.error("SPA sync error:", e);
            } finally {
                this.syncing = false;
            }
        }

        abort() {
            if (this.abortController) this.abortController.abort();
        }

        async _syncItems() {
            const data = await this.api.fetchAllItems();
            const items = (data.items || []).map((it) => ({
                id: it.id,
                name: it.name,
                type: it.type,
                image: it.image,
                marketPrice: it.value?.market_price || 0,
                sellPrice: it.value?.sell_price || 0,
                buyPrice: it.value?.buy_price || 0,
                circulation: it.circulation || 0,
                lastUpdated: Math.floor(Date.now() / 1000),
            }));
            await this.db.putBatch("items", items);
            this.parser.loadItems(items);
        }

        async _refreshDropPrices() {
            const openings = await this.db.getAll("openings");
            const ids = new Set();
            for (const o of openings) {
                for (const it of o.items) if (it.itemId) ids.add(it.itemId);
            }
            if (!ids.size) return;

            const idArr = [...ids];
            // Fetch in batches of 50
            for (let i = 0; i < idArr.length; i += 50) {
                const batch = idArr.slice(i, i + 50);
                try {
                    const data = await this.api.fetchItemsByIds(batch);
                    const items = (data.items || []).map((it) => ({
                        id: it.id,
                        name: it.name,
                        type: it.type,
                        image: it.image,
                        marketPrice: it.value?.market_price || 0,
                        sellPrice: it.value?.sell_price || 0,
                        buyPrice: it.value?.buy_price || 0,
                        circulation: it.circulation || 0,
                        lastUpdated: Math.floor(Date.now() / 1000),
                    }));
                    await this.db.putBatch("items", items);
                } catch (e) {
                    console.warn("SPA price refresh batch failed:", e);
                }
            }
        }

        async _savePriceSnapshot() {
            const items = await this.db.getAll("items");
            const ts = Math.floor(Date.now() / 1000);
            const snapshots = items
                .filter((it) => it.type === "Supply Pack" || it.marketPrice > 0)
                .map((it) => ({ itemId: it.id, timestamp: ts, marketPrice: it.marketPrice }));
            if (snapshots.length) await this.db.putBatch("priceHistory", snapshots);
        }
    }

    // ════════════════════════════════════════════════════════════
    //  CSS
    // ════════════════════════════════════════════════════════════

    function injectCSS() {
        const style = document.createElement("style");
        style.textContent = `
/* Supply Pack Analyzer */

/* Overlay & Panel */
#spa-overlay{display:none;position:fixed;inset:0;z-index:999998;background:rgba(0,0,0,.7)}
#spa-panel{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:999999;
  background:#1a1a1a;border:1px solid #444;border-radius:10px;overflow:hidden;resize:both;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#ddd;font-size:14px;
  width:760px;max-width:100vw;max-height:88vh;min-width:340px;min-height:300px;
  display:none;flex-direction:column}
#spa-panel *{box-sizing:border-box;color:inherit}

/* Dark scrollbars */
#spa-panel ::-webkit-scrollbar{width:6px;height:6px}
#spa-panel ::-webkit-scrollbar-track{background:#1a1a1a}
#spa-panel ::-webkit-scrollbar-thumb{background:#444;border-radius:3px}
#spa-panel ::-webkit-scrollbar-thumb:hover{background:#555}
#spa-panel{scrollbar-color:#444 #1a1a1a;scrollbar-width:thin}

#spa-header{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;
  background:#222;border-bottom:1px solid #444}
#spa-header h2{margin:0;font-size:17px;color:#fff}
#spa-header .spa-ver{color:#666;font-size:12px;margin-left:8px}
#spa-close{background:none;border:none;color:#999;font-size:22px;cursor:pointer;padding:4px 8px}
#spa-close:hover{color:#fff}
#spa-tabs{display:flex;background:#252525;border-bottom:1px solid #444;overflow-x:auto}
.spa-tab{padding:10px 20px;cursor:pointer;color:#999!important;border-bottom:2px solid transparent;
  white-space:nowrap;font-size:14px;transition:all .15s}
.spa-tab:hover{color:#ccc!important;background:#2a2a2a}
.spa-tab.active{color:#4fc3f7!important;border-bottom-color:#4fc3f7}
#spa-content{padding:16px;overflow-y:auto;flex:1;min-height:0}
.spa-cards{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.spa-card{background:#252525;border:1px solid #333;border-radius:8px;padding:12px;color:#ddd}
.spa-card .label{color:#888;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
.spa-card .value{font-size:22px;font-weight:700;margin-top:4px}
.spa-card .sub{color:#888;font-size:12px;margin-top:2px}
.spa-green{color:#4caf50!important}.spa-red{color:#ef5350!important}.spa-blue{color:#4fc3f7!important}.spa-yellow{color:#ffb74d!important}

/* Tables */
table.spa-table{width:100%;border-collapse:collapse;margin-top:8px}
.spa-table th,.spa-table td{padding:8px 12px;text-align:left;border-bottom:1px solid #333;font-size:14px;
  color:#ddd;white-space:nowrap;vertical-align:middle}
.spa-table th{color:#999!important;font-weight:600;text-transform:uppercase;font-size:12px;position:sticky;
  top:0;background:#1a1a1a;cursor:pointer;border-bottom:2px solid #444}
.spa-table th:hover{color:#fff!important}
.spa-table th[data-sort]::after{content:" ⇅";color:#555;font-size:10px}
.spa-table th[data-sort].sort-asc::after{content:" ▲";color:#4fc3f7;font-size:10px}
.spa-table th[data-sort].sort-desc::after{content:" ▼";color:#4fc3f7;font-size:10px}
.spa-table tbody tr:hover td{background:#252525}
.spa-table th.num,.spa-table td.num{text-align:right;font-variant-numeric:tabular-nums}
.spa-table-wrap{padding-right:0}

/* Column toggle */
.spa-col-toggle{display:inline-flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}
.spa-col-toggle label{font-size:11px;cursor:pointer;padding:3px 8px;border-radius:3px;user-select:none;
  transition:all .15s}
.spa-col-toggle input{display:none}
.spa-col-toggle label:has(input:checked){background:#1a3a4a;border:1px solid #4fc3f7}
.spa-col-toggle label:has(input:checked) span{color:#4fc3f7}
.spa-col-toggle label:has(input:not(:checked)){background:#333;border:1px solid #444}
.spa-col-toggle label:has(input:not(:checked)) span{color:#666}
.spa-col-toggle label:hover{border-color:#888}
.spa-col-hidden{display:none!important}

.spa-date-filter{display:flex;gap:8px;align-items:center;margin-bottom:16px;flex-wrap:wrap}
.spa-date-filter button{padding:5px 14px;background:#333;border:1px solid #444;color:#ccc;border-radius:4px;
  cursor:pointer;font-size:13px}
.spa-date-filter button:hover,.spa-date-filter button.active{background:#4fc3f7;color:#111;border-color:#4fc3f7}
.spa-date-filter input{background:#252525;border:1px solid #444;color:#ddd;padding:5px 8px;border-radius:4px;font-size:13px}
.spa-section{margin-bottom:20px}
.spa-section h3{margin:0 0 8px;font-size:14px;color:#eee}
.spa-section p{color:#aaa}
.spa-select{background:#252525;border:1px solid #444;color:#ddd;padding:6px 10px;border-radius:4px;font-size:14px;min-width:200px}
.spa-btn{padding:8px 16px;border:none;border-radius:4px;cursor:pointer;font-size:14px;font-weight:600;color:#ddd}
.spa-btn-primary{background:#4fc3f7;color:#111!important}.spa-btn-primary:hover{background:#29b6f6}
.spa-btn-danger{background:#ef5350;color:#fff!important}.spa-btn-danger:hover{background:#f44336}
.spa-btn-success{background:#4caf50;color:#fff!important}.spa-btn-success:hover{background:#43a047}
.spa-btn:disabled{opacity:.5;cursor:not-allowed}
.spa-input{background:#252525;border:1px solid #444;color:#ddd;padding:6px 10px;border-radius:4px;font-size:14px}
.spa-status{padding:8px 12px;background:#252525;border-radius:4px;color:#999;font-size:13px;margin:8px 0}
.spa-hint{color:#777;font-size:12px;margin:4px 0}
.spa-flex{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.spa-mt{margin-top:12px}.spa-mb{margin-bottom:12px}
.spa-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.spa-empty{text-align:center;color:#888;padding:30px 0;font-size:14px}

/* Mobile */
@media(max-width:768px){
  #spa-panel{width:100vw!important;max-width:100vw;min-width:0;border-radius:0;top:0;left:0;
    transform:none;max-height:100vh;height:100vh}
  .spa-grid-2{grid-template-columns:1fr}
  .spa-cards{grid-template-columns:1fr 1fr}
  .spa-date-filter{gap:4px}
}
`;
        document.head.appendChild(style);
    }

    // ════════════════════════════════════════════════════════════
    //  UI
    // ════════════════════════════════════════════════════════════

    class UI {
        constructor(db, api, analyzer, parser, syncManager) {
            this.db = db;
            this.api = api;
            this.analyzer = analyzer;
            this.parser = parser;
            this.sync = syncManager;
            this.activeTab = "dashboard";
            this.dateFrom = null;
            this.dateTo = null;
            this.selectedPack = null;
            this._sortCol = null;
            this._sortDir = 1;
        }

        inject() {
            injectCSS();

            // Overlay
            const overlay = document.createElement("div");
            overlay.id = "spa-overlay";
            document.body.appendChild(overlay);

            // Panel
            const panel = document.createElement("div");
            panel.id = "spa-panel";
            panel.innerHTML = `
                <div id="spa-header">
                    <h2>Supply Pack Analyzer <span class="spa-ver">v${VERSION}</span>
                        <span style="color:#888;font-size:11px;font-weight:400;margin-left:10px">
                            Like the script? Send a Xanax to
                            <a href="https://www.torn.com/profiles.php?XID=4192025" target="_blank"
                               style="color:#cc3333;text-decoration:none">eugene_s [4192025]</a>
                        </span>
                    </h2>
                    <button id="spa-close">&times;</button>
                </div>
                <div id="spa-tabs">
                    <div class="spa-tab active" data-tab="dashboard">Dashboard</div>
                    <div class="spa-tab" data-tab="packDetail">Pack Detail</div>
                    <div class="spa-tab" data-tab="settings">Settings</div>
                </div>
                <div id="spa-content"></div>
            `;
            document.body.appendChild(panel);

            // Register into the shared eugene-torn-scripts footer menu
            const W = (typeof unsafeWindow !== "undefined") ? unsafeWindow : window;
            W.registerEugeneScript({
                id: "spa",
                name: "Supply Pack Analyzer",
                color: "#c49000",
                colorDark: "#8a6500",
                hoverColor: "#daa520",
                iconSVG: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
                    <defs><linearGradient id="spa_icon_grad" x1="0.5" x2="0.5" y2="1" gradientUnits="objectBoundingBox">
                        <stop offset="0" stop-color="#ddd"/><stop offset="1" stop-color="#999"/>
                    </linearGradient></defs>
                    <g fill="url(#spa_icon_grad)"><path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18l6.5 3.25L12 10.68 5.5 7.43 12 4.18zM4 8.9l7 3.5v7.7l-7-3.5V8.9zm9 11.2v-7.7l7-3.5v7.7l-7 3.5z"/></g>
                </svg>`,
                onClick: () => this._toggle(true),
            });
            W.mountEugeneFooterMenu();

            // Events
            overlay.addEventListener("click", () => this._toggle(false));
            document.getElementById("spa-close").addEventListener("click", () => this._toggle(false));
            document.getElementById("spa-tabs").addEventListener("click", (e) => {
                const tab = e.target.closest(".spa-tab");
                if (tab) { this.activeTab = tab.dataset.tab; this._renderActiveTab(); this._updateTabs(); }
            });

            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape") this._toggle(false);
            });

            this.sync.onProgress = (msg) => {
                const el = document.getElementById("spa-sync-status");
                if (el) el.textContent = msg;
            };
        }

        _toggle(show) {
            document.getElementById("spa-panel").style.display = show ? "flex" : "none";
            document.getElementById("spa-overlay").style.display = show ? "block" : "none";
            if (show) { this._updateTabs(); this._renderActiveTab(); }
        }

        _updateTabs() {
            document.querySelectorAll(".spa-tab").forEach((t) => {
                t.classList.toggle("active", t.dataset.tab === this.activeTab);
            });
        }

        _content() { return document.getElementById("spa-content"); }

        async _renderActiveTab() {
            const c = this._content();
            c.innerHTML = '<div class="spa-empty">Loading...</div>';
            try {
                switch (this.activeTab) {
                    case "dashboard": await this._renderDashboard(c); break;
                    case "packDetail": await this._renderPackDetail(c); break;
                    case "settings": await this._renderSettings(c); break;
                }
            } catch (e) {
                c.innerHTML = `<div class="spa-empty">Error: ${e.message}</div>`;
                console.error("SPA render error:", e);
            }
        }

        // ── Date filter ─────────────────────────────────────

        _dateFilterHTML() {
            const now = Math.floor(Date.now() / 1000);
            return `<div class="spa-date-filter">
                <button data-range="week" class="${this._rangeActive("week")}">Last Week</button>
                <button data-range="month" class="${this._rangeActive("month")}">Last Month</button>
                <button data-range="year" class="${this._rangeActive("year")}">Last Year</button>
                <button data-range="all" class="${this._rangeActive("all")}">All Time</button>
                <input type="date" id="spa-from" value="${this._dateInputVal(this.dateFrom)}">
                <span style="color:#666">to</span>
                <input type="date" id="spa-to" value="${this._dateInputVal(this.dateTo)}">
                <button data-range="custom" class="spa-btn-primary spa-btn" style="padding:4px 10px">Apply</button>
            </div>`;
        }

        _rangeActive(r) {
            const now = Math.floor(Date.now() / 1000);
            if (r === "all" && !this.dateFrom && !this.dateTo) return "active";
            if (r === "week" && this.dateFrom && Math.abs(now - 7 * 86400 - this.dateFrom) < 3600) return "active";
            if (r === "month" && this.dateFrom && Math.abs(now - 30 * 86400 - this.dateFrom) < 3600) return "active";
            if (r === "year" && this.dateFrom && Math.abs(now - 365 * 86400 - this.dateFrom) < 3600) return "active";
            return "";
        }

        _dateInputVal(ts) {
            if (!ts) return "";
            return new Date(ts * 1000).toISOString().slice(0, 10);
        }

        _bindDateFilter() {
            const now = Math.floor(Date.now() / 1000);
            document.querySelectorAll(".spa-date-filter button").forEach((b) => {
                b.addEventListener("click", () => {
                    const r = b.dataset.range;
                    if (r === "all") { this.dateFrom = null; this.dateTo = null; }
                    else if (r === "week") { this.dateFrom = now - 7 * 86400; this.dateTo = null; }
                    else if (r === "month") { this.dateFrom = now - 30 * 86400; this.dateTo = null; }
                    else if (r === "year") { this.dateFrom = now - 365 * 86400; this.dateTo = null; }
                    else if (r === "custom") {
                        const f = document.getElementById("spa-from").value;
                        const t = document.getElementById("spa-to").value;
                        this.dateFrom = f ? Math.floor(new Date(f).getTime() / 1000) : null;
                        this.dateTo = t ? Math.floor(new Date(t + "T23:59:59").getTime() / 1000) : null;
                    }
                    this._renderActiveTab();
                });
            });
        }

        // ── Dashboard ───────────────────────────────────────

        async _renderDashboard(c) {
            const ov = await this.analyzer.getOverview(this.dateFrom, this.dateTo);
            const pnlClass = ov.pnl >= 0 ? "spa-green" : "spa-red";
            const roiClass = ov.roi >= 0 ? "spa-green" : "spa-red";

            let packRows = Object.values(ov.packs);
            if (this._sortCol) {
                packRows.sort((a, b) => {
                    let va = a[this._sortCol] ?? 0, vb = b[this._sortCol] ?? 0;
                    if (this._sortCol === "packName") { va = a.packName; vb = b.packName; return va.localeCompare(vb) * this._sortDir; }
                    const pnlA = a.totalValue - a.totalSpent, pnlB = b.totalValue - b.totalSpent;
                    if (this._sortCol === "pnl") { va = pnlA; vb = pnlB; }
                    if (this._sortCol === "roi") { va = a.totalSpent ? pnlA / a.totalSpent : 0; vb = b.totalSpent ? pnlB / b.totalSpent : 0; }
                    if (this._sortCol === "vpk") { va = a.opened ? a.totalValue / a.opened : 0; vb = b.opened ? b.totalValue / b.opened : 0; }
                    return (va - vb) * this._sortDir;
                });
            }

            c.innerHTML = `
                ${this._dateFilterHTML()}
                <div class="spa-cards">
                    <div class="spa-card"><div class="label">Total Spent</div>
                        <div class="value spa-yellow">${fmt.money(ov.totalSpent)}</div>
                        <div class="sub">Cost of ${fmt.num(ov.totalOpened)} opened</div></div>
                    <div class="spa-card"><div class="label">Total Value Gained</div>
                        <div class="value spa-blue">${fmt.money(ov.totalValue)}</div>
                        <div class="sub">${fmt.num(ov.totalOpened)} packs opened</div></div>
                    <div class="spa-card"><div class="label">Profit / Loss</div>
                        <div class="value ${pnlClass}">${fmt.money(ov.pnl)}</div>
                        <div class="sub">${fmt.moneyFull(ov.pnl)}</div></div>
                    <div class="spa-card"><div class="label">ROI</div>
                        <div class="value ${roiClass}">${fmt.pct(ov.roi)}</div>
                        <div class="sub">Avg ${fmt.money(ov.valuePerPack)} per pack</div></div>
                </div>
                ${packRows.length ? `
                <div class="spa-section">
                    <h3>Pack Performance</h3>
                    <div class="spa-table-wrap"><table class="spa-table" id="spa-pack-table">
                        <thead><tr>
                            <th data-sort="packName" class="${this._sortCls(this._sortCol, this._sortDir, "packName")}">Pack</th>
                            <th data-sort="opened" class="num ${this._sortCls(this._sortCol, this._sortDir, "opened")}">Opened</th>
                            <th data-sort="totalSpent" class="num ${this._sortCls(this._sortCol, this._sortDir, "totalSpent")}">Cost</th>
                            <th data-sort="totalValue" class="num ${this._sortCls(this._sortCol, this._sortDir, "totalValue")}">Value</th>
                            <th data-sort="pnl" class="num ${this._sortCls(this._sortCol, this._sortDir, "pnl")}">P&L</th>
                            <th data-sort="roi" class="num ${this._sortCls(this._sortCol, this._sortDir, "roi")}">ROI</th>
                            <th data-sort="vpk" class="num ${this._sortCls(this._sortCol, this._sortDir, "vpk")}">Val/Pack</th>
                        </tr></thead>
                        <tbody>
                        ${packRows.map((p) => {
                            const pnl = p.totalValue - p.totalSpent;
                            const roi = p.totalSpent > 0 ? (pnl / p.totalSpent) * 100 : 0;
                            const vpk = p.opened > 0 ? p.totalValue / p.opened : 0;
                            return `<tr data-pack="${p.packItemId}" style="cursor:pointer">
                                <td>${this._escHtml(p.packName)}</td>
                                <td class="num">${fmt.num(p.opened)}</td>
                                <td class="num">${fmt.money(p.totalSpent)}</td>
                                <td class="num">${fmt.money(p.totalValue)}</td>
                                <td class="num ${pnl >= 0 ? "spa-green" : "spa-red"}">${fmt.money(pnl)}</td>
                                <td class="num ${roi >= 0 ? "spa-green" : "spa-red"}">${fmt.pct(roi)}</td>
                                <td class="num">${fmt.money(vpk)}</td>
                            </tr>`;
                        }).join("")}
                        </tbody>
                    </table></div>
                </div>` : '<div class="spa-empty">No data yet. Add your API key and sync in Settings.</div>'}
            `;

            this._bindDateFilter();
            this._addColToggle("spa-pack-table", "dash", [2, 3, 6]);

            // Sort
            c.querySelectorAll("#spa-pack-table th[data-sort]").forEach((th) => {
                th.addEventListener("click", () => {
                    const col = th.dataset.sort;
                    if (this._sortCol === col) this._sortDir *= -1;
                    else { this._sortCol = col; this._sortDir = 1; }
                    this._renderActiveTab();
                });
            });

            // Click row → pack detail
            c.querySelectorAll("#spa-pack-table tr[data-pack]").forEach((tr) => {
                tr.addEventListener("click", () => {
                    this.selectedPack = tr.dataset.pack === "null" ? null : +tr.dataset.pack;
                    this.activeTab = "packDetail";
                    this._updateTabs();
                    this._renderActiveTab();
                });
            });
        }

        // ── Pack Detail ─────────────────────────────────────

        async _renderPackDetail(c) {
            const ov = await this.analyzer.getOverview(this.dateFrom, this.dateTo);
            const packKeys = Object.keys(ov.packs);

            if (!packKeys.length) {
                c.innerHTML = '<div class="spa-empty">No pack data available.</div>';
                return;
            }

            if (!this.selectedPack || !ov.packs[this.selectedPack])
                this.selectedPack = +packKeys[0];

            const pk = ov.packs[this.selectedPack];
            const ev = await this.analyzer.getEV(this.selectedPack);
            const sources = await this.analyzer.getBestSources(this.selectedPack, this.dateFrom, this.dateTo);
            const dr = await this.analyzer.getDropRates(this.selectedPack, this.dateFrom, this.dateTo);

            const pnl = pk.totalValue - pk.totalSpent;
            const roi = pk.totalSpent > 0 ? (pnl / pk.totalSpent) * 100 : 0;
            const vpk = pk.opened > 0 ? pk.totalValue / pk.opened : 0;
            const avgBuy = pk.avgBuyPrice || 0;
            const unopened = Math.max(0, pk.purchased - pk.opened);

            c.innerHTML = `
                ${this._dateFilterHTML()}
                <div class="spa-flex spa-mb">
                    <select class="spa-select" id="spa-pack-select">
                        ${packKeys.map((k) => `<option value="${k}" ${+k === this.selectedPack ? "selected" : ""}>${this._escHtml(ov.packs[k].packName)}</option>`).join("")}
                    </select>
                </div>

                <div class="spa-cards">
                    <div class="spa-card"><div class="label">Opened</div><div class="value">${fmt.num(pk.opened)}</div>
                        <div class="sub">${fmt.num(pk.purchased)} bought${unopened ? `, ${fmt.num(unopened)} unopened` : ""}</div></div>
                    <div class="spa-card"><div class="label">Cost of Opened</div><div class="value spa-yellow">${fmt.money(pk.totalSpent)}</div>
                        <div class="sub">Avg ${fmt.money(avgBuy)}/pack</div></div>
                    <div class="spa-card"><div class="label">Total Value</div><div class="value spa-blue">${fmt.money(pk.totalValue)}</div>
                        <div class="sub">${fmt.money(vpk)}/pack</div></div>
                    <div class="spa-card"><div class="label">P&L</div>
                        <div class="value ${pnl >= 0 ? "spa-green" : "spa-red"}">${fmt.money(pnl)}</div>
                        <div class="sub">ROI: ${fmt.pct(roi)}</div></div>
                </div>

                <div class="spa-grid-2">
                    <div class="spa-section">
                        <h3>Expected Value</h3>
                        ${ev ? `
                        <table class="spa-table">
                            <tr><td>Avg Return/Pack</td><td class="num">${fmt.money(ev.avgReturn)}</td></tr>
                            <tr><td>Avg Cost/Pack</td><td class="num">${fmt.money(ev.avgCost)}</td></tr>
                            <tr><td>EV (profit/pack)</td><td class="num ${ev.ev >= 0 ? "spa-green" : "spa-red"}">${fmt.money(ev.ev)}</td></tr>
                            <tr><td>Break-even Price</td><td class="num spa-blue">${fmt.money(ev.breakEven)}</td></tr>
                            <tr><td>Sample Size</td><td class="num">${fmt.num(ev.sampleSize)}</td></tr>
                        </table>` : '<div class="spa-empty">Not enough data</div>'}
                    </div>
                </div>

                <div class="spa-section">
                    <h3>Best Sources</h3>
                    ${sources.length ? `
                    <table class="spa-table">
                        <thead><tr><th>Channel</th><th class="num">Qty Bought</th><th class="num">Avg Price</th></tr></thead>
                        <tbody>${sources.map((s) => `
                            <tr><td>${s.channel === "itemmarket" ? "Item Market" : s.channel === "bazaar" ? "Bazaar" : s.channel}</td>
                                <td class="num">${fmt.num(s.totalQty)}</td>
                                <td class="num">${fmt.money(s.avgCost)}</td></tr>
                        `).join("")}</tbody>
                    </table>` : '<div class="spa-empty">No purchase data</div>'}
                </div>

                <div class="spa-section">
                    <h3>Loot Breakdown</h3>
                    ${dr.rates.length ? `
                    <div class="spa-table-wrap"><table class="spa-table" id="spa-loot-table">
                        <thead><tr>
                            <th data-sort="name">Item</th>
                            <th data-sort="totalQty" class="num">Total Qty</th>
                            <th data-sort="drops" class="num">Times Dropped</th>
                            <th data-sort="dropRate" class="num">Drop Rate</th>
                            <th data-sort="avgQtyPerDrop" class="num">Avg Qty/Drop</th>
                            <th data-sort="unitPrice" class="num">Unit Price</th>
                            <th data-sort="valueContribution" class="num">Value/Pack</th>
                        </tr></thead>
                        <tbody>${dr.rates.map((r) => `
                            <tr><td>${this._escHtml(r.name)}</td>
                                <td class="num">${fmt.num(r.totalQty)}</td>
                                <td class="num">${fmt.num(r.drops)}</td>
                                <td class="num">${r.dropRate.toFixed(1)}%</td>
                                <td class="num">${r.avgQtyPerDrop.toFixed(2)}</td>
                                <td class="num">${fmt.money(r.unitPrice)}</td>
                                <td class="num">${fmt.money(r.valueContribution)}</td></tr>
                        `).join("")}</tbody>
                    </table></div>` : '<div class="spa-empty">No drops recorded</div>'}
                </div>
            `;

            this._bindDateFilter();
            this._addColToggle("spa-loot-table", "loot", [1, 2, 4]);
            document.getElementById("spa-pack-select").addEventListener("change", (e) => {
                this.selectedPack = +e.target.value;
                this._renderActiveTab();
            });

            // Loot table sorting
            c.querySelectorAll("#spa-loot-table th[data-sort]").forEach((th) => {
                th.addEventListener("click", () => {
                    const col = th.dataset.sort;
                    if (this._lootSortCol === col) this._lootSortDir *= -1;
                    else { this._lootSortCol = col; this._lootSortDir = -1; }
                    // Update sort indicator classes
                    c.querySelectorAll("#spa-loot-table th[data-sort]").forEach((h) => {
                        h.classList.remove("sort-asc", "sort-desc");
                    });
                    th.classList.add(this._lootSortDir > 0 ? "sort-asc" : "sort-desc");
                    // Sort rows
                    const tbody = document.querySelector("#spa-loot-table tbody");
                    const rows = [...tbody.querySelectorAll("tr")];
                    const ci = [...th.parentNode.children].indexOf(th);
                    rows.sort((a, b) => {
                        const at = a.children[ci].textContent.trim();
                        const bt = b.children[ci].textContent.trim();
                        if (col === "name") return at.localeCompare(bt) * this._lootSortDir;
                        const an = parseFloat(at.replace(/[$,%]/g, "").replace(/,/g, "")) || 0;
                        const bn = parseFloat(bt.replace(/[$,%]/g, "").replace(/,/g, "")) || 0;
                        return (an - bn) * this._lootSortDir;
                    });
                    for (const r of rows) tbody.appendChild(r);
                });
            });
        }

        // ── Settings ────────────────────────────────────────

        async _renderSettings(c) {
            const apiKey = this.api.apiKey;
            const lastSync = localStorage.getItem(LS("lastSync"));
            const openCount = await this.db.count("openings");
            const purchCount = await this.db.count("purchases");
            const itemCount = await this.db.count("items");

            c.innerHTML = `
                <div class="spa-grid-2">
                    <div>
                        <div class="spa-section">
                            <h3>API Configuration</h3>
                            <p class="spa-hint">Requires a <strong style="color:#ddd">Full Access</strong> API key to read your logs.</p>
                            <p class="spa-hint">Your key is stored locally in your browser and is only sent directly to the official Torn API. It is never shared with any third party.</p>
                            <div class="spa-flex spa-mb">
                                <input type="password" class="spa-input" id="spa-apikey" placeholder="Paste your Full Access API key"
                                    value="${apiKey}" style="flex:1">
                                <button class="spa-btn spa-btn-primary" id="spa-validate-key">Validate</button>
                            </div>
                            <div id="spa-key-status" class="spa-status">${apiKey ? "Key saved" : "No API key set"}</div>
                        </div>

                        <div class="spa-section">
                            <h3>Sync</h3>
                            <div class="spa-flex spa-mb">
                                <button class="spa-btn spa-btn-primary" id="spa-sync-btn" ${!apiKey ? "disabled" : ""}>Sync Now</button>
                                <button class="spa-btn spa-btn-danger" id="spa-sync-abort" style="display:none">Stop</button>
                            </div>
                            <p class="spa-hint">First sync may take a few minutes depending on your log history. Subsequent syncs are much faster as only new data is fetched.</p>
                            <div id="spa-sync-status" class="spa-status">
                                ${lastSync ? "Last sync: " + new Date(+lastSync).toLocaleString() : "Never synced"}
                            </div>
                        </div>

                        <div class="spa-section">
                            <h3>Database</h3>
                            <table class="spa-table">
                                <tr><td>Opening logs</td><td class="num">${fmt.num(openCount)}</td></tr>
                                <tr><td>Purchase logs</td><td class="num">${fmt.num(purchCount)}</td></tr>
                                <tr><td>Items in database</td><td class="num">${fmt.num(itemCount)}</td></tr>
                            </table>
                            <div class="spa-flex spa-mt">
                                <button class="spa-btn spa-btn-danger" id="spa-clear-data">Clear All Data</button>
                                <button class="spa-btn" id="spa-export-data" style="background:#555;color:#ddd">Export JSON</button>
                                <label class="spa-btn" style="background:#555;color:#ddd;cursor:pointer">
                                    Import JSON <input type="file" id="spa-import-data" accept=".json" style="display:none">
                                </label>
                            </div>
                        </div>
                    </div>

                </div>
            `;

            // Bind events
            document.getElementById("spa-validate-key").addEventListener("click", async () => {
                const key = document.getElementById("spa-apikey").value.trim();
                const status = document.getElementById("spa-key-status");
                if (!key) { status.textContent = "Please enter a key"; return; }
                status.textContent = "Validating...";
                try {
                    const data = await this.api.validate(key);
                    if (data.error) { status.innerHTML = `<span class="spa-red">Invalid: ${data.error.error}</span>`; return; }
                    localStorage.setItem(LS("apiKey"), key);
                    this.api.apiKey = key;
                    status.innerHTML = `<span class="spa-green">Valid! Player: ${data.player_id || data.name || "OK"}</span>`;
                    document.getElementById("spa-sync-btn").disabled = false;
                } catch (e) {
                    status.innerHTML = `<span class="spa-red">Error: ${e.message}</span>`;
                }
            });

            document.getElementById("spa-sync-btn").addEventListener("click", async () => {
                const btn = document.getElementById("spa-sync-btn");
                const abortBtn = document.getElementById("spa-sync-abort");
                btn.disabled = true;
                abortBtn.style.display = "inline-block";
                await this.sync.sync();
                btn.disabled = false;
                abortBtn.style.display = "none";
                // Reload parser items
                const items = await this.db.getAll("items");
                this.parser.loadItems(items);
                this._renderActiveTab();
            });

            document.getElementById("spa-sync-abort").addEventListener("click", () => {
                this.sync.abort();
            });

            document.getElementById("spa-clear-data").addEventListener("click", async () => {
                if (!confirm("Clear ALL analyzer data? This cannot be undone.")) return;
                await this.db.clear("openings");
                await this.db.clear("purchases");
                await this.db.clear("items");
                await this.db.clear("priceHistory");
                localStorage.removeItem(LS("lastOpenSync"));
                localStorage.removeItem(LS("lastBuySync"));
                localStorage.removeItem(LS("lastSync"));
                this._renderActiveTab();
            });

            document.getElementById("spa-export-data").addEventListener("click", async () => {
                const data = {
                    version: VERSION,
                    exported: new Date().toISOString(),
                    openings: await this.db.getAll("openings"),
                    purchases: await this.db.getAll("purchases"),
                    items: await this.db.getAll("items"),
                };
                const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `spa-export-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
            });

            document.getElementById("spa-import-data").addEventListener("change", async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    if (data.openings) await this.db.putBatch("openings", data.openings);
                    if (data.purchases) await this.db.putBatch("purchases", data.purchases);
                    if (data.items) await this.db.putBatch("items", data.items);
                    alert(`Imported: ${data.openings?.length || 0} openings, ${data.purchases?.length || 0} purchases, ${data.items?.length || 0} items`);
                    this._renderActiveTab();
                } catch (err) {
                    alert("Import failed: " + err.message);
                }
            });
        }

        // ── Helpers ─────────────────────────────────────────

        _sortCls(stateCol, stateDir, col) {
            if (stateCol !== col) return "";
            return stateDir > 0 ? "sort-asc" : "sort-desc";
        }

        /**
         * Add column toggle buttons above a table.
         * storageKey persists choices. mobileHidden = array of column indices (1-based) to hide by default on mobile.
         */
        _addColToggle(tableId, storageKey, mobileHidden = []) {
            const table = document.getElementById(tableId);
            if (!table) return;
            const headers = [...table.querySelectorAll("thead th")];
            if (headers.length < 3) return;

            const isMobile = window.innerWidth <= 768;
            const saved = JSON.parse(localStorage.getItem(LS("cols_" + storageKey)) || "null");

            // Build full state: if saved exists use it, otherwise build defaults
            const state = {};
            headers.forEach((_, i) => {
                if (i === 0) return;
                if (saved && saved[i] !== undefined) {
                    state[i] = saved[i];
                } else {
                    state[i] = isMobile ? !mobileHidden.includes(i) : true;
                }
            });

            const wrap = document.createElement("div");
            wrap.className = "spa-col-toggle";

            const applyCol = (i, show) => {
                table.querySelectorAll(`th:nth-child(${i + 1}), td:nth-child(${i + 1})`).forEach((el) => {
                    el.classList.toggle("spa-col-hidden", !show);
                });
            };

            headers.forEach((th, i) => {
                if (i === 0) return;
                const name = th.textContent.trim().replace(/[⇅▲▼]/g, "").trim();
                const visible = state[i];
                const label = document.createElement("label");
                label.innerHTML = `<input type="checkbox" ${visible ? "checked" : ""}><span>${name}</span>`;
                const cb = label.querySelector("input");

                // Apply initial state
                applyCol(i, visible);

                cb.addEventListener("change", () => {
                    state[i] = cb.checked;
                    applyCol(i, cb.checked);
                    localStorage.setItem(LS("cols_" + storageKey), JSON.stringify(state));
                });
                wrap.appendChild(label);
            });

            // Save full state so future renders are consistent
            localStorage.setItem(LS("cols_" + storageKey), JSON.stringify(state));
            table.parentNode.insertBefore(wrap, table);
        }

        _escHtml(s) {
            if (!s) return "";
            return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        }
    }

    // ════════════════════════════════════════════════════════════
    //  Shared footer menu (eugene-torn-scripts userscripts)
    //  — 1 script installed: its icon goes in the footer directly.
    //  — 2+ installed: a single 3-dots menu holds them all and
    //    expands a row above the footer on click.
    //  Idempotent and duplicated verbatim across scripts. The
    //  __eugFooterMenuLoaded guard ensures setup runs once per page.
    // ════════════════════════════════════════════════════════════

    (function setupEugFooterMenu() {
        // Use the page's real window so scripts in different @grant sandboxes
        // share the same registry. SPA (@grant none) and TAT (@grant GM_*)
        // otherwise see isolated `window` objects and can't find each other.
        const W = (typeof unsafeWindow !== "undefined") ? unsafeWindow : window;
        if (W.__eugFooterMenuLoaded) return;
        W.__eugFooterMenuLoaded = true;
        W.__eugeneScripts = W.__eugeneScripts || [];

        const ROW_ID = "eug-footer-row";

        function injectCSS() {
            if (document.getElementById("eug-footer-style")) return;
            const style = document.createElement("style");
            style.id = "eug-footer-style";
            style.textContent = `
[data-eug="menu"]{background:linear-gradient(to bottom,#444,#2a2a2a)!important}
[data-eug="menu"]:hover{background:linear-gradient(to bottom,#555,#333)!important}
#${ROW_ID}{display:none;position:fixed;padding:4px;
  background:rgba(20,20,20,0.96);border:1px solid #444;border-radius:6px;
  gap:4px;z-index:2147483647;white-space:nowrap;pointer-events:auto}
#${ROW_ID}.eug-open{display:flex;flex-direction:row}
`;
            document.head.appendChild(style);
        }

        function injectEntryCSS(entry) {
            if (!entry.color) return;
            const id = `eug-color-${entry.id}`;
            const existing = document.getElementById(id);
            const dark = entry.colorDark || "#222";
            const hover = entry.hoverColor || entry.color;
            const css = `
[data-eug-id="${entry.id}"]{background:linear-gradient(to bottom, ${entry.color}, ${dark})!important}
[data-eug-id="${entry.id}"]:hover{background:linear-gradient(to bottom, ${hover}, ${entry.color})!important}
`;
            if (existing) { existing.textContent = css; return; }
            const el = document.createElement("style");
            el.id = id;
            el.textContent = css;
            document.head.appendChild(el);
        }

        function findRefBtn() {
            return document.getElementById("notes_panel_button")
                || document.getElementById("people_panel_button");
        }

        function getRow() { return document.getElementById(ROW_ID); }
        function closeRow() { const r = getRow(); if (r) r.classList.remove("eug-open"); }

        function openRow(menuBtn) {
            const row = getRow();
            if (!row) return;
            const rect = menuBtn.getBoundingClientRect();
            row.classList.add("eug-open");
            const rowRect = row.getBoundingClientRect();
            const gap = 6;
            const centerX = rect.left + rect.width / 2;
            let left = centerX - rowRect.width / 2;
            const maxLeft = window.innerWidth - rowRect.width - 4;
            left = Math.max(4, Math.min(left, maxLeft));
            row.style.left = left + "px";
            row.style.bottom = (window.innerHeight - rect.top + gap) + "px";
        }

        function makeScriptBtn(entry, refBtn, role) {
            const iconClasses = refBtn.querySelector("svg")?.className?.baseVal || "";
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = refBtn.className;
            btn.title = entry.name;
            btn.setAttribute("data-eug", role);
            btn.setAttribute("data-eug-id", entry.id);
            const svg = (entry.iconSVG || "").replace(/<svg\b([^>]*)>/, (match, attrs) =>
                /\sclass\s*=/.test(attrs) ? match : `<svg${attrs} class="${iconClasses}">`);
            btn.innerHTML = svg;
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeRow();
                try { entry.onClick(); } catch { /* noop */ }
            });
            injectEntryCSS(entry);
            return btn;
        }

        function makeMenuBtn(refBtn) {
            const iconClasses = refBtn.querySelector("svg")?.className?.baseVal || "";
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = refBtn.className;
            btn.title = "My userscripts";
            btn.setAttribute("data-eug", "menu");
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" class="${iconClasses}">
                <defs><linearGradient id="eug_menu_grad" x1="0.5" x2="0.5" y2="1" gradientUnits="objectBoundingBox">
                    <stop offset="0" stop-color="#ddd"/><stop offset="1" stop-color="#999"/>
                </linearGradient></defs>
                <g fill="url(#eug_menu_grad)">
                    <circle cx="5" cy="12" r="2"/>
                    <circle cx="12" cy="12" r="2"/>
                    <circle cx="19" cy="12" r="2"/>
                </g>
            </svg>`;
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const row = getRow();
                if (row && row.classList.contains("eug-open")) closeRow();
                else openRow(btn);
            });
            return btn;
        }

        // Legacy standalone-button IDs from pre-shared-menu versions.
        // If a user has a mixed install (one script new, one old), the old
        // script creates its own button under one of these IDs. Nuke them
        // so the shared menu stays authoritative. Safe to add new IDs here.
        const LEGACY_BUTTON_IDS = ["tat-footer-btn", "spa-footer-btn"];

        function render() {
            const refBtn = findRefBtn();
            if (!refBtn) return false;
            injectCSS();

            const parent = refBtn.parentNode;
            parent.querySelectorAll('[data-eug]').forEach((el) => el.remove());
            LEGACY_BUTTON_IDS.forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.remove();
            });
            const oldRow = getRow();
            if (oldRow) oldRow.remove();

            const scripts = W.__eugeneScripts || [];
            if (scripts.length === 0) return true;

            if (scripts.length === 1) {
                parent.insertBefore(makeScriptBtn(scripts[0], refBtn, "solo"), refBtn);
            } else {
                const menuBtn = makeMenuBtn(refBtn);
                parent.insertBefore(menuBtn, refBtn);
                const row = document.createElement("div");
                row.id = ROW_ID;
                row.setAttribute("data-eug-row", "");
                for (const s of scripts) row.appendChild(makeScriptBtn(s, refBtn, "item"));
                document.body.appendChild(row);
            }
            return true;
        }

        function mount() {
            if (render()) return;
            const obs = new MutationObserver(() => { if (render()) obs.disconnect(); });
            obs.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => obs.disconnect(), 30000);
        }

        W.addEventListener("eugene-scripts-updated", render);
        document.addEventListener("click", (e) => {
            const row = getRow();
            if (!row || !row.classList.contains("eug-open")) return;
            const menuBtn = document.querySelector('[data-eug="menu"]');
            if (menuBtn && menuBtn.contains(e.target)) return;
            if (row.contains(e.target)) return;
            closeRow();
        });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRow(); });
        W.addEventListener("scroll", closeRow, { passive: true });
        W.addEventListener("resize", closeRow);

        W.registerEugeneScript = function (entry) {
            const list = W.__eugeneScripts;
            const i = list.findIndex((s) => s.id === entry.id);
            if (i >= 0) list[i] = entry;
            else list.push(entry);
            W.dispatchEvent(new CustomEvent("eugene-scripts-updated"));
        };
        W.mountEugeneFooterMenu = mount;
    })();

    // ════════════════════════════════════════════════════════════
    //  MAIN
    // ════════════════════════════════════════════════════════════

    async function main() {
        const db = new Database();
        await db.open();

        const api = new TornAPI();
        const parser = new LogParser();
        const analyzer = new Analyzer(db);
        const syncManager = new SyncManager(db, api, parser);
        const ui = new UI(db, api, analyzer, parser, syncManager);

        // Pre‑load item definitions if available
        const items = await db.getAll("items");
        if (items.length) parser.loadItems(items);

        ui.inject();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", main);
    } else {
        main();
    }
})();
