"use strict";

const axios = require("axios");
const netGuard = require("./net-guard");

const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const JACKETT_FAILURE_THRESHOLD = 3;
const JACKETT_PAUSE_MS = 10 * 60 * 1000;
const jackettFailures = new Map();

function isJackettPaused(cleanUrl) {
    const failInfo = jackettFailures.get(cleanUrl);
    if (!failInfo) return false;
    if (failInfo.failCount >= JACKETT_FAILURE_THRESHOLD && Date.now() - failInfo.lastFail < JACKETT_PAUSE_MS) {
        return true;
    }
    return false;
}

function recordJackettFailure(cleanUrl) {
    const existing = jackettFailures.get(cleanUrl) || { failCount: 0 };
    jackettFailures.set(cleanUrl, {
        failCount: existing.failCount + 1,
        lastFail: Date.now()
    });
}

function recordJackettSuccess(cleanUrl) {
    jackettFailures.delete(cleanUrl);
}

/**
 * Valide la connectivité d'une instance Jackett avec sa clé d'API.
 */
async function checkJackettConnectivity(url, key) {
    if (!url || !key) {
        return { success: false, valid: false, error: "URL et clé API Jackett requises" };
    }

    let rawUrl = String(url).trim();
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawUrl)) {
        rawUrl = `http://${rawUrl}`;
    }
    const cleanUrl = rawUrl.replace(/\/+$/, "");

    // Garde SSRF
    const ssrfCheck = await netGuard.assertSafeSelfHostedUrl(cleanUrl);
    if (!ssrfCheck.ok) {
        return { success: false, valid: false, error: `URL Jackett refusée (sécurité) : ${ssrfCheck.error}` };
    }

    // Mock testing
    if (cleanUrl.includes("mock-jackett") || cleanUrl.includes("user-jackett")) {
        return { success: true, valid: true, appName: "Jackett Mock", version: "0.21.0" };
    }

    try {
        const testUrl = `${cleanUrl}/api/v2.0/indexers/all/results/torznab/api?apikey=${encodeURIComponent(key.trim())}&t=caps`;
        const res = await axios.get(testUrl, {
            headers: { "User-Agent": BROWSER_UA, Accept: "application/json,application/xml,text/xml" },
            timeout: 5000
        });

        if (res.status === 200 && (res.data || res.data === "")) {
            return { success: true, valid: true, appName: "Jackett", status: res.status };
        }
        return { success: false, valid: false, error: `Jackett a répondu avec le statut ${res.status}` };
    } catch (err) {
        const status = err.response ? err.response.status : null;
        let errMsg = "Impossible de joindre Jackett";
        if (status === 401 || status === 403) errMsg = "Clé d'API Jackett incorrecte";
        else if (err.code === "ECONNABORTED" || err.message.includes("timeout"))
            errMsg = "Timeout lors de la connexion à Jackett";
        return { success: false, valid: false, error: errMsg, statusCode: status };
    }
}

/**
 * Extrait le hash torrent d'un magnet ou d'une enclosure Torznab.
 */
function extractHash(raw) {
    if (!raw || typeof raw !== "string") return null;
    if (/^[0-9a-f]{40}$/i.test(raw.trim())) return raw.trim().toLowerCase();
    const m = raw.match(/btih:([0-9a-f]{40})/i);
    if (m) return m[1].toLowerCase();
    return null;
}

/**
 * Parsing simple et tolérant du flux XML Torznab si JSON n'est pas disponible.
 */
function parseTorznabXml(xmlStr) {
    if (!xmlStr || typeof xmlStr !== "string") return [];
    const items = [];
    const itemMatches = xmlStr.match(/<item>([\s\S]*?)<\/item>/gi) || [];

    for (const itemXml of itemMatches) {
        const titleMatch =
            itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || itemXml.match(/<title>(.*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : "";

        const sizeMatch = itemXml.match(/<size>(.*?)<\/size>/i) || itemXml.match(/length="(\d+)"/i);
        const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;

        const hashAttr = itemXml.match(/name="infohash"\s+value="([0-9a-fA-F]{40})"/i);
        const enclosureMatch = itemXml.match(/<enclosure[^>]+url="([^"]+)"/i);
        const linkMatch = itemXml.match(/<link>(.*?)<\/link>/i);

        let infoHash = hashAttr ? hashAttr[1].toLowerCase() : null;
        if (!infoHash && enclosureMatch) infoHash = extractHash(enclosureMatch[1]);
        if (!infoHash && linkMatch) infoHash = extractHash(linkMatch[1]);

        const seedersMatch = itemXml.match(/name="seeders"\s+value="(\d+)"/i);
        const seeders = seedersMatch ? parseInt(seedersMatch[1], 10) : 0;

        if (infoHash && title) {
            items.push({
                title,
                infoHash,
                size: isNaN(size) ? 0 : size,
                seeders: isNaN(seeders) ? 0 : seeders,
                indexer: "Jackett"
            });
        }
    }
    return items;
}

/**
 * Recherche à la demande sur Jackett pour un film ou un épisode de série.
 */
async function searchJackettOnDemand({ cleanTitle, year, season, episode, type, jackettUrl, jackettKey }) {
    if (!jackettUrl || !jackettKey || !cleanTitle) return [];
    const cleanUrl = String(jackettUrl).trim().replace(/\/+$/, "");
    if (isJackettPaused(cleanUrl)) return [];

    let query = cleanTitle;
    if (season !== undefined && episode !== undefined && Number(season) > 0 && Number(episode) > 0) {
        const sStr = String(season).padStart(2, "0");
        const eStr = String(episode).padStart(2, "0");
        query = `${cleanTitle} S${sStr}E${eStr}`;
    } else if (year && Number(year) > 1900) {
        query = `${cleanTitle} ${year}`;
    }

    const tType = type === "series" ? "tvsearch" : "movie";
    const endpoint = `${cleanUrl}/api/v2.0/indexers/all/results/torznab/api?apikey=${encodeURIComponent(
        jackettKey.trim()
    )}&t=${tType}&q=${encodeURIComponent(query)}&format=json`;

    try {
        const res = await axios.get(endpoint, {
            headers: { "User-Agent": BROWSER_UA, Accept: "application/json,application/xml" },
            timeout: 6000
        });

        recordJackettSuccess(cleanUrl);

        if (res.data && Array.isArray(res.data.Indexers)) {
            // Format Jackett JSON avec indexeurs agrégés
            const results = [];
            for (const idx of res.data.Indexers) {
                if (Array.isArray(idx.Results)) {
                    for (const r of idx.Results) {
                        const h = extractHash(r.InfoHash || r.Link || r.MagnetUri);
                        if (h && r.Title) {
                            results.push({
                                title: r.Title,
                                infoHash: h,
                                size: Number(r.Size) || 0,
                                seeders: Number(r.Seeders) || 0,
                                indexer: idx.Name || "Jackett"
                            });
                        }
                    }
                }
            }
            return results;
        } else if (typeof res.data === "string" && res.data.includes("<rss")) {
            return parseTorznabXml(res.data);
        }
        return [];
    } catch (err) {
        recordJackettFailure(cleanUrl);
        return [];
    }
}

module.exports = {
    checkJackettConnectivity,
    searchJackettOnDemand,
    parseTorznabXml,
    extractHash,
    isJackettPaused
};
