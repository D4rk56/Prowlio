"use strict";

const axios = require("axios");
const { makeLRU } = require("./helpers");

const DEBRIDLINK_API_BASE = "https://debrid-link.com/api/v2";
const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const dlApi = axios.create({
    baseURL: DEBRIDLINK_API_BASE,
    timeout: 10000,
    headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json"
    }
});

// Cache mémoire L1 de disponibilité instantanée (1 heure)
const dlInstantCache = makeLRU(1000, 3600_000);

// Cibles mortes en quarantaine (10 minutes)
const deadTargets = makeLRU(500, 10 * 60 * 1000);
const DEAD_TARGET_LOG_MS = 10 * 60 * 1000;

function isDebridLinkTargetDead(targetRef) {
    if (!targetRef) return false;
    return deadTargets.has(String(targetRef).toLowerCase());
}

function markDebridLinkTargetDead(targetRef, reason) {
    if (!targetRef) return;
    const key = String(targetRef).toLowerCase();
    if (deadTargets.has(key)) return;
    deadTargets.set(key, { reason: reason || "indisponible", at: Date.now() });
    console.warn(
        `[DebridLink] Cible ${key} mise en quarantaine ${DEAD_TARGET_LOG_MS / 60000} min (${reason || "indisponible"}).`
    );
}

function resetDebridLinkDeadTargets() {
    deadTargets.clear();
}

/**
 * Valide une clé d'API Debrid-Link et retourne les informations du compte.
 */
async function checkDebridLinkKey(apiKey) {
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 5) {
        return { success: false, valid: false, error: "Clé Debrid-Link manquante ou invalide" };
    }
    const cleanKey = apiKey.trim();
    try {
        const res = await dlApi.get("/account/infos", {
            headers: { Authorization: `Bearer ${cleanKey}` }
        });
        if (res.status === 200 && res.data && res.data.success && res.data.value) {
            const val = res.data.value;
            const isPremium = Boolean(val.premiumLeft && val.premiumLeft > 0);
            return {
                success: true,
                valid: true,
                user: val.pseudo || "Utilisateur Debrid-Link",
                isPremium,
                premiumLeft: val.premiumLeft || 0
            };
        }
        return { success: false, valid: false, error: "Réponse utilisateur Debrid-Link inattendue" };
    } catch (err) {
        const status = err.response ? err.response.status : null;
        let errMsg = "Erreur de connexion à Debrid-Link";
        if (status === 401) errMsg = "Clé d'API Debrid-Link invalide ou expirée";
        else if (status === 403) errMsg = "Accès refusé par Debrid-Link";
        else if (err.code === "ECONNABORTED" || err.message.includes("timeout"))
            errMsg = "Délai d'attente dépassé (timeout Debrid-Link)";
        return { success: false, valid: false, error: errMsg, statusCode: status };
    }
}

/**
 * Vérifie par lot la disponibilité instantanée de torrents chez Debrid-Link.
 * Retourne un dictionnaire { [hash]: boolean }.
 */
async function checkInstantDebridLink(hashes, apiKey) {
    if (!hashes || !Array.isArray(hashes) || hashes.length === 0 || !apiKey) {
        return {};
    }

    const cleanHashes = hashes
        .map(h =>
            String(h || "")
                .trim()
                .toLowerCase()
        )
        .filter(h => /^[a-f0-9]{40}$/.test(h));

    if (cleanHashes.length === 0) return {};

    const result = {};
    const toQuery = [];

    for (const h of cleanHashes) {
        const cached = dlInstantCache.get(h);
        if (cached !== undefined) {
            result[h] = cached;
        } else {
            toQuery.push(h);
        }
    }

    if (toQuery.length === 0) return result;

    // Découpage par lots de 50 hashs
    const BATCH_SIZE = 50;
    for (let i = 0; i < toQuery.length; i += BATCH_SIZE) {
        const batch = toQuery.slice(i, i + BATCH_SIZE);
        try {
            const endpoint = `/seedbox/cached?url=${batch.join(",")}`;
            const res = await dlApi.get(endpoint, {
                headers: { Authorization: `Bearer ${apiKey.trim()}` },
                timeout: 5000
            });

            if (res.status === 200 && res.data && res.data.success && res.data.value) {
                const map = res.data.value;
                for (const h of batch) {
                    const isInstant = Boolean(map[h]);
                    result[h] = isInstant;
                    dlInstantCache.set(h, isInstant);
                }
            }
        } catch (err) {
            for (const h of batch) {
                if (result[h] === undefined) {
                    result[h] = false;
                }
            }
        }
    }

    return result;
}

/**
 * Débride un lien direct (1fichier, Rapidgator, etc.) via le downloader Debrid-Link.
 */
async function unrestrictDebridLink(url, apiKey) {
    if (!url || !apiKey) return null;
    try {
        const res = await dlApi.post(
            "/downloader/add",
            { url },
            {
                headers: { Authorization: `Bearer ${apiKey.trim()}` },
                timeout: 7000
            }
        );

        if (res.status === 200 && res.data && res.data.success && res.data.value) {
            const val = res.data.value;
            const downloadUrl = val.downloadUrl || val.streamUrl || val.url;
            if (downloadUrl) {
                return {
                    downloadUrl,
                    filename: val.name || "",
                    filesize: val.size || 0
                };
            }
        }
        return null;
    } catch (err) {
        return null;
    }
}

/**
 * Ajoute un torrent à la seedbox Debrid-Link et récupère les fichiers.
 */
async function addDebridLinkTorrent(magnetUri, apiKey) {
    if (!magnetUri || !apiKey) return null;
    try {
        const res = await dlApi.post(
            "/seedbox/add",
            { url: magnetUri, async: true },
            {
                headers: { Authorization: `Bearer ${apiKey.trim()}` },
                timeout: 7000
            }
        );

        if (res.status === 200 && res.data && res.data.success && res.data.value) {
            return res.data.value;
        }
        return null;
    } catch (err) {
        return null;
    }
}

/**
 * Supprime un torrent de la seedbox Debrid-Link.
 */
async function deleteDebridLinkTorrent(id, apiKey) {
    if (!id || !apiKey) return false;
    try {
        const res = await dlApi.delete(`/seedbox/${id}/remove`, {
            headers: { Authorization: `Bearer ${apiKey.trim()}` },
            timeout: 4000
        });
        return res.status === 200 && res.data && res.data.success;
    } catch (err) {
        return false;
    }
}

/**
 * Résolution complète d'un torrent ou lien sur Debrid-Link.
 */
async function resolveDebridLinkMagnet(magnetOrHash, apiKey, _options = {}) {
    if (!magnetOrHash || !apiKey) return null;

    let magnetUri = magnetOrHash;
    let hash = "";

    if (/^[a-f0-9]{40}$/i.test(magnetOrHash)) {
        hash = magnetOrHash.toLowerCase();
        magnetUri = `magnet:?xt=urn:btih:${hash}`;
    } else if (magnetOrHash.startsWith("magnet:")) {
        const m = magnetOrHash.match(/btih:([a-f0-9]{40})/i);
        if (m) hash = m[1].toLowerCase();
    }

    if (hash && isDebridLinkTargetDead(hash)) {
        return null;
    }

    try {
        const added = await addDebridLinkTorrent(magnetUri, apiKey);
        if (!added) {
            if (hash) markDebridLinkTargetDead(hash, "échec ajout Debrid-Link");
            return null;
        }

        const files = Array.isArray(added.files) ? added.files : [];
        if (files.length === 0) {
            if (hash) markDebridLinkTargetDead(hash, "aucun fichier dans le torrent");
            return null;
        }

        // Fichier vidéo principal
        const videoFiles = files.filter(f => /\.(mp4|mkv|avi|mov|ts|m4v)$/i.test(f.name || ""));
        const targetFile = videoFiles.length > 0 ? videoFiles[0] : files[0];

        const directUrl = targetFile.downloadUrl || targetFile.streamUrl;
        if (directUrl) {
            return directUrl;
        }

        if (_options.allowDownload) {
            console.log(`[DebridLink] Mode download actif pour ${hash || added.id}. Conservé dans la seedbox.`);
            return { downloading: true, provider: "DebridLink", torrentId: added.id };
        }

        await deleteDebridLinkTorrent(added.id, apiKey);
        if (hash) markDebridLinkTargetDead(hash, "URL de stream Debrid-Link absente (téléchargement requis)");
        return null;
    } catch (err) {
        if (hash) markDebridLinkTargetDead(hash, err.message);
        return null;
    }
}

module.exports = {
    DEBRIDLINK_API_BASE,
    dlApi,
    checkDebridLinkKey,
    checkInstantDebridLink,
    unrestrictDebridLink,
    addDebridLinkTorrent,
    deleteDebridLinkTorrent,
    resolveDebridLinkMagnet,
    isDebridLinkTargetDead,
    markDebridLinkTargetDead,
    resetDebridLinkDeadTargets
};
