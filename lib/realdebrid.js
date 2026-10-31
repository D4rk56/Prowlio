"use strict";

const axios = require("axios");
const { makeLRU } = require("./helpers");

const REALDEBRID_API_BASE = "https://api.real-debrid.com/rest/1.0";
const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const rdApi = axios.create({
    baseURL: REALDEBRID_API_BASE,
    timeout: 10000,
    headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json"
    }
});

// Cache mémoire L1 de disponibilité instantanée (1 heure)
const rdInstantCache = makeLRU(1000, 3600_000);

// Cibles mortes en quarantaine (10 minutes)
const deadTargets = makeLRU(500, 10 * 60 * 1000);
const DEAD_TARGET_LOG_MS = 10 * 60 * 1000;

function isRealDebridTargetDead(targetRef) {
    if (!targetRef) return false;
    return deadTargets.has(String(targetRef).toLowerCase());
}

function markRealDebridTargetDead(targetRef, reason) {
    if (!targetRef) return;
    const key = String(targetRef).toLowerCase();
    if (deadTargets.has(key)) return;
    deadTargets.set(key, { reason: reason || "indisponible", at: Date.now() });
    console.warn(
        `[RealDebrid] Cible ${key} mise en quarantaine ${DEAD_TARGET_LOG_MS / 60000} min (${reason || "indisponible"}).`
    );
}

function resetRealDebridDeadTargets() {
    deadTargets.clear();
}

/**
 * Valide une clé d'API Real-Debrid et retourne les informations du compte.
 */
async function checkRealDebridKey(apiKey) {
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 5) {
        return { success: false, valid: false, error: "Clé Real-Debrid manquante ou invalide" };
    }
    const cleanKey = apiKey.trim();
    try {
        const res = await rdApi.get("/user", {
            headers: { Authorization: `Bearer ${cleanKey}` }
        });
        if (res.status === 200 && res.data && res.data.id) {
            const isPremium = res.data.type === "premium" && new Date(res.data.expiration).getTime() > Date.now();
            return {
                success: true,
                valid: true,
                user: res.data.username || `User_${res.data.id}`,
                isPremium,
                expiration: res.data.expiration || null,
                points: res.data.points || 0
            };
        }
        return { success: false, valid: false, error: "Réponse utilisateur Real-Debrid inattendue" };
    } catch (err) {
        const status = err.response ? err.response.status : null;
        let errMsg = "Erreur de connexion à Real-Debrid";
        if (status === 401) errMsg = "Clé d'API Real-Debrid invalide ou révoquée";
        else if (status === 403) errMsg = "Accès refusé par Real-Debrid (compte suspendu ou IP bloquée)";
        else if (err.code === "ECONNABORTED" || err.message.includes("timeout"))
            errMsg = "Délai d'attente dépassé (timeout Real-Debrid)";
        return { success: false, valid: false, error: errMsg, statusCode: status };
    }
}

/**
 * Vérifie par lot la disponibilité instantanée de torrents chez Real-Debrid.
 * Retourne un dictionnaire { [hash]: boolean }.
 */
async function checkInstantRealDebrid(hashes, apiKey) {
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
        const cached = rdInstantCache.get(h);
        if (cached !== undefined) {
            result[h] = cached;
        } else {
            toQuery.push(h);
        }
    }

    if (toQuery.length === 0) return result;

    // Découpage par lots de 50 hashs (limite d'URL sûre)
    const BATCH_SIZE = 50;
    for (let i = 0; i < toQuery.length; i += BATCH_SIZE) {
        const batch = toQuery.slice(i, i + BATCH_SIZE);
        try {
            const endpoint = `/torrents/instantAvailability/${batch.join("/")}`;
            const res = await rdApi.get(endpoint, {
                headers: { Authorization: `Bearer ${apiKey.trim()}` },
                timeout: 5000
            });

            if (res.status === 200 && res.data && typeof res.data === "object") {
                for (const h of batch) {
                    const hashData = res.data[h];
                    let isInstant = false;
                    if (hashData && Array.isArray(hashData.rd) && hashData.rd.length > 0) {
                        isInstant = true;
                    }
                    result[h] = isInstant;
                    rdInstantCache.set(h, isInstant);
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
 * Ajoute un magnet sur Real-Debrid et sélectionne automatiquement les fichiers vidéo.
 */
async function addRealDebridMagnet(magnetUri, apiKey) {
    if (!magnetUri || !apiKey) return null;
    try {
        const params = new URLSearchParams();
        params.append("magnet", magnetUri);

        const res = await rdApi.post("/torrents/addMagnet", params.toString(), {
            headers: {
                Authorization: `Bearer ${apiKey.trim()}`,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });

        if (res.status === 201 && res.data && res.data.id) {
            return res.data;
        }
        return null;
    } catch (err) {
        console.warn(`[RealDebrid] Échec addMagnet:`, err.response?.data || err.message);
        return null;
    }
}

/**
 * Récupère les métadonnées d'un torrent Real-Debrid (fichiers, statut, liens).
 */
async function getRealDebridTorrentInfo(torrentId, apiKey) {
    if (!torrentId || !apiKey) return null;
    try {
        const res = await rdApi.get(`/torrents/info/${torrentId}`, {
            headers: { Authorization: `Bearer ${apiKey.trim()}` },
            timeout: 5000
        });
        if (res.status === 200 && res.data) {
            return res.data;
        }
        return null;
    } catch (err) {
        return null;
    }
}

/**
 * Sélectionne les fichiers à débrider pour un torrent donné.
 */
async function selectRealDebridFiles(torrentId, fileIds, apiKey) {
    if (!torrentId || !apiKey) return false;
    try {
        const filesStr = Array.isArray(fileIds) ? fileIds.join(",") : String(fileIds || "all");
        const params = new URLSearchParams();
        params.append("files", filesStr);

        const res = await rdApi.post(`/torrents/selectFiles/${torrentId}`, params.toString(), {
            headers: {
                Authorization: `Bearer ${apiKey.trim()}`,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });
        return res.status === 204 || res.status === 200;
    } catch (err) {
        return false;
    }
}

/**
 * Débride un lien Real-Debrid (ou un lien hébergeur 1fichier/Rapidgator) en URL directe CDN.
 */
async function unrestrictRealDebridLink(linkUrl, apiKey) {
    if (!linkUrl || !apiKey) return null;
    try {
        const params = new URLSearchParams();
        params.append("link", linkUrl);

        const res = await rdApi.post("/unrestrict/link", params.toString(), {
            headers: {
                Authorization: `Bearer ${apiKey.trim()}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            timeout: 7000
        });

        if (res.status === 200 && res.data && res.data.download) {
            return {
                downloadUrl: res.data.download,
                filename: res.data.filename || "",
                filesize: res.data.filesize || 0,
                streamable: Boolean(res.data.streamable)
            };
        }
        return null;
    } catch (err) {
        return null;
    }
}

/**
 * Supprime un torrent de la seedbox Real-Debrid.
 */
async function deleteRealDebridTorrent(torrentId, apiKey) {
    if (!torrentId || !apiKey) return false;
    try {
        const res = await rdApi.delete(`/torrents/delete/${torrentId}`, {
            headers: { Authorization: `Bearer ${apiKey.trim()}` },
            timeout: 4000
        });
        return res.status === 204 || res.status === 200;
    } catch (err) {
        return false;
    }
}

/**
 * Résolution complète d'un infoHash ou magnet sur Real-Debrid :
 * 1. Ajout du magnet
 * 2. Sélection des fichiers
 * 3. Récupération des liens débridés
 * 4. Déblocage du lien correspondant vers le CDN
 */
async function resolveRealDebridMagnet(magnetOrHash, apiKey, _options = {}) {
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

    if (hash && isRealDebridTargetDead(hash)) {
        return null;
    }

    try {
        const added = await addRealDebridMagnet(magnetUri, apiKey);
        if (!added || !added.id) {
            if (hash) markRealDebridTargetDead(hash, "échec ajout magnet Real-Debrid");
            return null;
        }

        const torrentId = added.id;
        let info = await getRealDebridTorrentInfo(torrentId, apiKey);
        if (!info) {
            if (hash) markRealDebridTargetDead(hash, "info introuvable");
            return null;
        }

        // Si en attente de sélection de fichiers
        if (info.status === "waiting_files_selection" && Array.isArray(info.files)) {
            const videoExts = /\.(mp4|mkv|avi|mov|wmv|ts|m4v|webm)$/i;
            const videoFiles = info.files.filter(f => videoExts.test(f.path || ""));
            const selectedIds = videoFiles.length > 0 ? videoFiles.map(f => f.id) : info.files.map(f => f.id);
            await selectRealDebridFiles(torrentId, selectedIds, apiKey);

            info = await getRealDebridTorrentInfo(torrentId, apiKey);
        }

        if (!info || !Array.isArray(info.links) || info.links.length === 0) {
            if (
                _options.allowDownload &&
                info &&
                (info.status === "downloading" ||
                    info.status === "queued" ||
                    info.status === "magnet_conversion" ||
                    info.status === "uploading")
            ) {
                console.log(
                    `[RealDebrid] Mode download actif pour ${hash || torrentId} (statut: ${info.status}). Conservé dans Real-Debrid.`
                );
                return { downloading: true, provider: "RealDebrid", torrentId };
            }
            await deleteRealDebridTorrent(torrentId, apiKey);
            if (hash) markRealDebridTargetDead(hash, "aucun lien disponible après sélection");
            return null;
        }

        const targetLink = info.links[0];
        const unlocked = await unrestrictRealDebridLink(targetLink, apiKey);
        if (unlocked && unlocked.downloadUrl) {
            return unlocked.downloadUrl;
        }

        if (hash) markRealDebridTargetDead(hash, "débridage lien échoué");
        return null;
    } catch (err) {
        if (hash) markRealDebridTargetDead(hash, err.message);
        return null;
    }
}

module.exports = {
    REALDEBRID_API_BASE,
    rdApi,
    checkRealDebridKey,
    checkInstantRealDebrid,
    addRealDebridMagnet,
    getRealDebridTorrentInfo,
    selectRealDebridFiles,
    unrestrictRealDebridLink,
    deleteRealDebridTorrent,
    resolveRealDebridMagnet,
    isRealDebridTargetDead,
    markRealDebridTargetDead,
    resetRealDebridDeadTargets
};
