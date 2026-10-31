"use strict";

const axios = require("axios");
const alldebrid = require("./alldebrid");
const adGet = (...args) => alldebrid.adGet(...args);
const getMagnetFiles = (...args) => alldebrid.getMagnetFiles(...args);
const { isTorboxTorrentReady } = require("./torbox");

// Version du manifeste, lue depuis package.json (source de vérité unique).
const { version: ADDON_VERSION } = require("../package.json");
const { getCachedTorrentsByImdb, getMovieVersions, asyncTouchUserActivity, getSystemSettings } = require("./db");
const { searchProwlarrOnDemand } = require("./prowlarr-worker");
const {
    TMDB_KEY_DEFAULT,
    isCustomTmdbKey,
    flattenFiles,
    isRealVideoFile,
    isExcludedArtifact,
    extractTechBadge,
    sortByLangPref,
    filterAndSortStreams,
    resolveKitsuMeta,
    parseSeasonEpisode,
    extractCleanTitle,
    getTmdbMetadata,
    generateFallbackPoster,
    imdbIdToTitle,
    imdbIdToTitleAndYear,
    isConfidentTitleMatch,
    formatAioStream,
    parseSizeFromString,
    isObfuscated
} = require("./helpers");

const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
let lumioDownUntil = 0;
let torrentioDownUntil = 0;

function safeDecode(str) {
    if (typeof str !== "string") return str;
    try {
        return decodeURIComponent(str);
    } catch (e) {
        return str;
    }
}

function handleManifest(config = {}, baseUrl = "", _userRef = "") {
    const base = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
    const pseudoStr =
        config.pseudo && typeof config.pseudo === "string" && config.pseudo.trim() ? ` (${config.pseudo.trim()})` : "";

    const ADDON_TYPES = ["movie", "series", "anime"];
    const ADDON_ID_PREFIXES = ["tt", "kitsu", "ad_cloud:", "ad_link:", "ad_series:", "tb_cloud:"];

    const resources = [{ name: "stream", types: ADDON_TYPES, idPrefixes: ADDON_ID_PREFIXES }];

    const manifest = {
        id: "org.nuvio.alldebrid",
        version: ADDON_VERSION,
        name: `Prowlio${pseudoStr}`,
        description: ` ☁️🎬 Addon de streaming haute performance pour Stremio et Nuvio (v${ADDON_VERSION}). ✨ Débridage Real-Debrid, AllDebrid, Torbox & Debrid-Link, indexeur Prowlarr & Jackett en temps réel.`,
        behaviorHints: {
            configurable: true,
            configurationRequired: false
        },
        types: ADDON_TYPES,
        idPrefixes: ADDON_ID_PREFIXES,
        resources: resources,
        catalogs: []
    };

    if (base) {
        manifest.logo = `${base}/logo.png`;
        manifest.background = `${base}/background.png`;
    }

    return manifest;
}

async function handleMeta(config, type, id, cache) {
    const { apiKey } = config;
    const tmdbKey = config.tmdbKey && config.tmdbKey !== "default" ? config.tmdbKey : TMDB_KEY_DEFAULT;

    // Fichier issu de "Mes Liens" ou "Historique"
    if (id.startsWith("ad_link:")) {
        const originalLink = Buffer.from(id.replace("ad_link:", ""), "base64url").toString();
        let fname = originalLink.split("/").pop() || "Fichier";
        try {
            fname = decodeURIComponent(fname);
        } catch (e) {}

        const targetType = type === "series" ? "series" : "movie";
        const tmdb = await getTmdbMetadata(fname, targetType, tmdbKey, true);
        const se = parseSeasonEpisode(fname);
        const badge = extractTechBadge(fname);

        const videoEntry =
            targetType === "series"
                ? [
                      {
                          id: id,
                          title: fname,
                          season: se ? se.season : 1,
                          episode: se ? se.episode : 1,
                          released: new Date().toISOString()
                      }
                  ]
                : undefined;

        return {
            meta: {
                id,
                type: targetType,
                name: tmdb.name || fname,
                poster: tmdb.poster || generateFallbackPoster(tmdb.name || fname),
                background: tmdb.backdrop || null,
                description: `${badge ? badge + "\n" : ""}${fname}\n\n${tmdb.description || ""}`,
                genres: tmdb.genres || [],
                cast: tmdb.cast || [],
                imdbRating: tmdb.imdbRating || null,
                videos: videoEntry
            }
        };
    }

    // Fiche Série ou Épisode de série depuis le cloud
    if (id.startsWith("ad_series:")) {
        const payload = id.replace("ad_series:", "");
        const parts = payload.split(":");
        const lastPart = parts[parts.length - 1];
        const secondLastPart = parts[parts.length - 2];
        const isEpisode = parts.length >= 3 && !isNaN(parseInt(lastPart, 10)) && !isNaN(parseInt(secondLastPart, 10));

        if (isEpisode) {
            const episode = parseInt(parts.pop(), 10);
            const season = parseInt(parts.pop(), 10);
            let groupTitle;
            try {
                groupTitle = decodeURIComponent(parts.join(":"));
            } catch (e) {
                groupTitle = parts.join(":");
            }
            const tmdb = await getTmdbMetadata(groupTitle, "series", tmdbKey, true);
            return {
                meta: {
                    id,
                    type: "series",
                    name: `${tmdb.name || groupTitle} S${season}E${episode}`,
                    poster: tmdb.poster || generateFallbackPoster(groupTitle),
                    background: tmdb.backdrop || null,
                    description: `Saison ${season} Épisode ${episode}\n\n${tmdb.description || ""}`,
                    genres: tmdb.genres || [],
                    cast: tmdb.cast || [],
                    imdbRating: tmdb.imdbRating || null
                }
            };
        } else {
            // Dossier Série (fiche principale avec arborescence des épisodes)
            let seriesTitle;
            try {
                seriesTitle = decodeURIComponent(payload);
            } catch (e) {
                seriesTitle = payload;
            }
            const tmdb = await getTmdbMetadata(seriesTitle, "series", tmdbKey, true);
            const displayTitle = tmdb.name || seriesTitle;
            const cleanLower = seriesTitle.toLowerCase();

            // Récupération des épisodes disponibles dans le cache ou compte AllDebrid
            let episodes = [];
            if (cache && cache.series && cache.series[cleanLower] && Array.isArray(cache.series[cleanLower].episodes)) {
                episodes = cache.series[cleanLower].episodes;
            } else {
                try {
                    const [statusRes, linksRes, histRes] = await Promise.all([
                        adGet("/v4.1/magnet/status", apiKey).catch(() => null),
                        adGet("/v4/user/links", apiKey).catch(() => null),
                        adGet("/v4/user/history", apiKey).catch(() => null)
                    ]);
                    const magnets =
                        (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
                    const linksData =
                        (linksRes && linksRes.data && linksRes.data.data && linksRes.data.data.links) || [];
                    const histData = histRes && histRes.data && histRes.data.data;
                    const histLinks = Array.isArray(histData)
                        ? histData
                        : Array.isArray(histData?.history)
                          ? histData.history
                          : Array.isArray(histData?.links)
                            ? histData.links
                            : [];
                    const allUserLinks = [
                        ...(Array.isArray(linksData) ? linksData : []),
                        ...(Array.isArray(histLinks) ? histLinks : [])
                    ];

                    const found = [];
                    for (const m of magnets) {
                        const mTitle = extractCleanTitle(m.filename || "").title.toLowerCase();
                        if (mTitle === cleanLower || mTitle.includes(cleanLower) || cleanLower.includes(mTitle)) {
                            const se = parseSeasonEpisode(m.filename || "");
                            if (!se || se.isSeasonPack || se.episode === null) {
                                let filesMap = {};
                                try {
                                    filesMap = await getMagnetFiles(m.id, apiKey);
                                } catch (e) {}
                                const rawFiles = filesMap[m.id];
                                const flat = flattenFiles(rawFiles).filter(f =>
                                    isRealVideoFile(f.n || f.name || f.filename)
                                );
                                if (flat.length > 0) {
                                    for (const f of flat) {
                                        const fname = f.n || f.name || f.filename || "";
                                        const fSe = parseSeasonEpisode(fname);
                                        const epSeason = fSe && fSe.season ? fSe.season : (se && se.season) || 1;
                                        const epNum =
                                            fSe && fSe.episode !== null && !isNaN(fSe.episode) ? fSe.episode : 1;
                                        found.push({ season: epSeason, episode: epNum, filename: fname });
                                    }
                                } else if (se) {
                                    found.push({
                                        season: se.season || 1,
                                        episode: se.episode || 1,
                                        filename: m.filename
                                    });
                                }
                            } else {
                                found.push({ season: se.season || 1, episode: se.episode, filename: m.filename });
                            }
                        }
                    }
                    for (const l of allUserLinks) {
                        if (!l) continue;
                        const lName = l.filename || l.name || "";
                        if (isObfuscated(lName)) continue;
                        const lTitle = extractCleanTitle(lName).title.toLowerCase();
                        if (lTitle === cleanLower || lTitle.includes(cleanLower) || cleanLower.includes(lTitle)) {
                            const se = parseSeasonEpisode(lName);
                            if (se) {
                                const epNum = se.episode !== null && !isNaN(se.episode) ? se.episode : 1;
                                found.push({ season: se.season || 1, episode: epNum, filename: lName });
                            }
                        }
                    }
                    const seen = new Set();
                    for (const ep of found) {
                        const k = `${ep.season}:${ep.episode}`;
                        if (!seen.has(k)) {
                            seen.add(k);
                            episodes.push(ep);
                        }
                    }
                } catch (e) {}
            }

            episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
            if (episodes.length === 0) {
                episodes = [{ season: 1, episode: 1, filename: displayTitle }];
            }

            return {
                meta: {
                    id,
                    type: "series",
                    name: displayTitle,
                    poster: tmdb.poster || generateFallbackPoster(displayTitle),
                    background: tmdb.backdrop || null,
                    description: `Dossier Série • ${episodes.length} épisode(s) disponible(s)\n\n${tmdb.description || ""}`,
                    genres: tmdb.genres || [],
                    cast: tmdb.cast || [],
                    imdbRating: tmdb.imdbRating || null,
                    videos: episodes.map(ep => ({
                        id: `ad_series:${encodeURIComponent(seriesTitle)}:${ep.season}:${ep.episode}`,
                        title: `Saison ${ep.season} Épisode ${ep.episode}`,
                        season: ep.season,
                        episode: ep.episode,
                        released: new Date().toISOString()
                    }))
                }
            };
        }
    }

    // Fiche pour un fichier cloud AllDebrid ou Torbox
    let filename = "";
    if (id.startsWith("ad_cloud:") || id.startsWith("tb_cloud:")) {
        const isTb = id.startsWith("tb_cloud:");
        const cloudRef = id.replace(/^(ad|tb)_cloud:/, "");

        if (isTb) {
            // Format : tb_cloud:<torrentId> ou tb_cloud:<torrentId>:<fileId>
            const parts = cloudRef.split(":");
            const torrentId = parts[0];
            const fileId = parts[1];
            const tbApiKey = config.torboxApiKey || process.env.TORBOX_API_KEY || apiKey;
            try {
                const { getTorboxTorrentList } = require("./torbox");
                const list = await getTorboxTorrentList(tbApiKey, torrentId).catch(() => []);
                const tor = Array.isArray(list) ? list.find(t => String(t.id) === String(torrentId)) || list[0] : null;
                if (tor) {
                    if (fileId && Array.isArray(tor.files)) {
                        const f = tor.files.find(x => String(x.id) === String(fileId));
                        if (f) filename = f.name || f.filename || tor.name || "";
                        else filename = tor.name || "";
                    } else {
                        filename = tor.name || "";
                    }
                }
            } catch (e) {}
        } else {
            const statusRes = await adGet("/v4.1/magnet/status", apiKey, { id: cloudRef }).catch(() => null);
            const rawMagnets = statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets;
            const magnetData = Array.isArray(rawMagnets) ? rawMagnets[0] : rawMagnets;
            if (magnetData) filename = magnetData.filename || "";

            if (isObfuscated(filename)) {
                const filesMap = await getMagnetFiles([cloudRef], apiKey).catch(() => ({}));
                const files = filesMap[cloudRef] || [];
                const flat = flattenFiles(files).filter(f => f.n && isRealVideoFile(f.n));
                if (flat.length > 0) {
                    flat.sort((a, b) => (b.s || 0) - (a.s || 0));
                    filename = flat[0].n;
                }
            }
        }
    } else {
        const versions = getMovieVersions(id);
        if (versions && versions[0]) filename = versions[0].filename;
    }

    if (id.startsWith("tt")) {
        const cleanId = id.split(":")[0];
        const isSeries = type === "series" || id.includes(":");
        const hasCustomTmdbKey = isCustomTmdbKey(tmdbKey);

        // Priorité TMDB (cohérent avec resolveCatalogMeta qui affiche le titre FR dans le catalogue)
        if (hasCustomTmdbKey) {
            const titleMeta = await imdbIdToTitleAndYear(cleanId, tmdbKey, type);
            if (titleMeta && titleMeta.title) {
                const tmdb = await getTmdbMetadata(titleMeta.title, type, tmdbKey, true);
                if (tmdb && tmdb.name) {
                    return {
                        meta: {
                            id,
                            type,
                            name: tmdb.name,
                            poster: tmdb.poster || generateFallbackPoster(tmdb.name),
                            background: tmdb.backdrop || null,
                            description: tmdb.description || "Disponible sur Prowlio.",
                            genres: tmdb.genres || [],
                            cast: tmdb.cast || [],
                            imdbRating: tmdb.imdbRating || null
                        }
                    };
                }
            }
        }

        // Repli direct sur Cinemeta par identifiant IMDb (100% fiable, poster et synopsis officiels)
        try {
            const cType = isSeries ? "series" : "movie";
            const cinRes = await axios
                .get(`https://v3-cinemeta.strem.io/meta/${cType}/${encodeURIComponent(cleanId)}.json`, {
                    headers: { "User-Agent": BROWSER_UA },
                    timeout: 5000
                })
                .catch(() => null);
            if (cinRes && cinRes.data && cinRes.data.meta) {
                const cm = cinRes.data.meta;
                return {
                    meta: {
                        id,
                        type,
                        name: cm.name,
                        poster: cm.poster || generateFallbackPoster(cm.name),
                        background: cm.background || cm.poster || null,
                        description: cm.description || "Disponible sur Prowlio.",
                        genres: cm.genres || (cm.genre ? [cm.genre] : []),
                        cast: cm.cast || [],
                        imdbRating: cm.imdbRating || null,
                        videos: isSeries ? cm.videos || [] : undefined
                    }
                };
            }
        } catch (e) {}
    }

    const tmdb = await getTmdbMetadata(filename, type, tmdbKey, true);
    return {
        meta: {
            id,
            type,
            name: tmdb.name,
            poster: tmdb.poster,
            background: tmdb.backdrop,
            description: `${filename}\n\n${tmdb.description || ""}`,
            genres: tmdb.genres,
            cast: tmdb.cast,
            imdbRating: tmdb.imdbRating
        }
    };
}

async function handleCatalog() {
    // Fonctionnalité catalogues supprimée : Prowlio se concentre exclusivement
    // sur la livraison de flux de streaming haute performance.
    return { metas: [] };
}

/**
 * Gestionnaire ultra-rapide des flux Stremio (< 5 ms) avec URLs de résolution Lazy
 */
async function handleStream(config, type, id, cache, baseUrl, userRef) {
    const rawDebridProvider = (config.debridProvider || "alldebrid").toLowerCase();
    const isBoth = rawDebridProvider === "both";
    const isMulti = rawDebridProvider === "multi";
    const isTorbox = rawDebridProvider === "torbox";
    const isRealDebrid = rawDebridProvider === "realdebrid";
    const isDebridLink = rawDebridProvider === "debridlink";
    const hasAllDebrid = (rawDebridProvider === "alldebrid" || isBoth || isMulti) && Boolean(config.apiKey);
    const hasTorbox =
        (rawDebridProvider === "torbox" || isBoth || isMulti) &&
        Boolean(config.torboxApiKey || (isTorbox && config.apiKey));
    const hasRealDebrid = (isRealDebrid || isMulti || isBoth) && Boolean(config.realdebridApiKey);
    const hasDebridLink = (isDebridLink || isMulti || isBoth) && Boolean(config.debridlinkApiKey);
    const apiKey = config.apiKey;
    const activeTbApiKey = config.torboxApiKey || (isTorbox ? config.apiKey : null);
    const activeRdApiKey = config.realdebridApiKey;
    const activeDlApiKey = config.debridlinkApiKey;
    const debridProvider = isTorbox
        ? "torbox"
        : isRealDebrid
          ? "realdebrid"
          : isDebridLink
            ? "debridlink"
            : "alldebrid";
    const debridName = isMulti
        ? "Multi-Debrid"
        : isBoth
          ? "Dual (AD+TB)"
          : isRealDebrid
            ? "Real-Debrid"
            : isDebridLink
              ? "Debrid-Link"
              : isTorbox
                ? "Torbox"
                : "AllDebrid";

    const tmdbKey = config.tmdbKey && config.tmdbKey !== "default" ? config.tmdbKey : TMDB_KEY_DEFAULT;
    const cacheEnabled = config.cacheMode !== "off";
    const langPrefArray = config.langPref
        ? Array.isArray(config.langPref)
            ? config.langPref
            : safeDecode(config.langPref).split(",").filter(Boolean)
        : ["multi_vff", "vff", "vfi", "multi", "vf", "vostfr"];

    const streams = [];
    const seenHashes = new Set();

    // 1. Fichier issu de "Mes Liens" (ad_link:base64)
    if (id.startsWith("ad_link:")) {
        const originalLink = Buffer.from(id.replace("ad_link:", ""), "base64url").toString();
        const fname = originalLink.split("/").pop() || "Fichier";
        streams.push(
            formatAioStream({
                filename: fname,
                sizeBytes: 0,
                provider: "Mon Cloud",
                indexer: "AllDebrid Cloud",
                subtitle: "Résolution instantanée",
                isInstant: true,
                cacheType: "cloud",
                isCloud: true,
                debridProvider: "alldebrid",
                url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(originalLink)}`
            })
        );
        return { streams: sortByLangPref(streams, langPrefArray) };
    }

    // 2. Fichier issu d'un épisode cloud direct (ad_series:...)
    if (id.startsWith("ad_series:")) {
        streams.push(
            formatAioStream({
                filename: id,
                sizeBytes: 0,
                provider: "Mon Cloud",
                indexer: "AllDebrid Cloud",
                subtitle: "Résolution instantanée",
                isInstant: true,
                cacheType: "cloud",
                isCloud: true,
                debridProvider: "alldebrid",
                url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(id)}`
            })
        );
        return { streams: sortByLangPref(streams, langPrefArray) };
    }

    // 3. Fichier issu de ad_cloud:<magnetId> ou tb_cloud:<torrentId>:<fileId>
    if (id.startsWith("ad_cloud:") || id.startsWith("tb_cloud:")) {
        const isTb = id.startsWith("tb_cloud:");
        const cloudRef = id.replace(/^(ad|tb)_cloud:/, "");
        streams.push(
            formatAioStream({
                filename: `Cloud #${cloudRef}`,
                sizeBytes: 0,
                provider: "Mon Cloud",
                indexer: isTb ? "Torbox Cloud" : "AllDebrid Cloud",
                subtitle: "Résolution instantanée",
                isInstant: true,
                cacheType: "cloud",
                isCloud: true,
                debridProvider: isTb ? "torbox" : "alldebrid",
                url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(id)}`
            })
        );
        return { streams: sortByLangPref(streams, langPrefArray) };
    }

    // Résolution précoce des métadonnées pour les identifiants IMDb
    let searchTitle = null;
    let searchAltTitle = null;
    let searchYear = null;
    let seasonNum = undefined;
    let episodeNum = undefined;
    let effectiveImdbId = id;

    if (id.startsWith("tt")) {
        const baseTtId = id.split(":")[0];
        const metaInfo = await imdbIdToTitleAndYear(baseTtId, tmdbKey, type);
        searchTitle = metaInfo?.title || null;
        searchAltTitle = metaInfo?.altTitle || null;
        searchYear = metaInfo?.year || null;
        if (id.includes(":")) {
            const parts = id.split(":");
            seasonNum = parseInt(parts[1], 10);
            episodeNum = parseInt(parts[2], 10);
        }
    }

    // 4. Épisode de série avec identifiant IMDb ("tt...:s:e")
    if (id.startsWith("tt") && id.includes(":")) {
        const parts = id.split(":");
        const baseTtId = parts[0];
        const season = seasonNum;
        const episode = episodeNum;

        // Vérification directe dans cache.series (liens débridés, historique ou cloud)
        if (cache && cache.series && cache.series[baseTtId] && Array.isArray(cache.series[baseTtId].episodes)) {
            const epMatches = cache.series[baseTtId].episodes.filter(e => e.season === season && e.episode === episode);
            for (const ep of epMatches) {
                if (ep.link) {
                    streams.push(
                        formatAioStream({
                            filename: ep.filename || `S${season}E${episode}`,
                            sizeBytes: 0,
                            provider: "Mon Cloud",
                            indexer: "AllDebrid Cloud",
                            subtitle: "Épisode disponible dans votre Historique/Liens",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "alldebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(ep.link)}`
                        })
                    );
                } else if (ep.magnetId) {
                    streams.push(
                        formatAioStream({
                            filename: ep.filename || `S${season}E${episode}`,
                            sizeBytes: 0,
                            provider: "Mon Cloud",
                            indexer: "AllDebrid Cloud",
                            subtitle: "Épisode disponible dans votre compte AllDebrid",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "alldebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(ep.magnetId)}`
                        })
                    );
                } else if (ep.tbRef) {
                    streams.push(
                        formatAioStream({
                            filename: ep.filename || `S${season}E${episode}`,
                            sizeBytes: 0,
                            provider: "Mon Cloud",
                            indexer: "Torbox Cloud",
                            subtitle: "Épisode disponible dans votre compte Torbox",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "torbox",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/tb_cloud:${ep.tbRef}`
                        })
                    );
                }
            }
        }

        let groupTitle = cache && cache.series && cache.series[baseTtId] ? cache.series[baseTtId].groupTitle : null;
        if (!groupTitle) {
            const title = searchTitle || (await imdbIdToTitle(baseTtId, tmdbKey));
            if (title) {
                groupTitle = title.toLowerCase();
                if (cache && cache.series) {
                    let sEntry = cache.series[baseTtId];
                    if (!sEntry || typeof sEntry !== "object") {
                        sEntry = { groupTitle, episodes: [] };
                    } else {
                        sEntry.groupTitle = groupTitle;
                        if (!Array.isArray(sEntry.episodes)) {
                            sEntry.episodes = [];
                        }
                    }
                    cache.series[baseTtId] = sEntry;
                }
            }
        }
        if (groupTitle) {
            if (hasTorbox && activeTbApiKey) {
                try {
                    const { getTorboxTorrentList } = require("./torbox");
                    const tbTorrents = await getTorboxTorrentList(activeTbApiKey).catch(() => []);
                    if (Array.isArray(tbTorrents)) {
                        for (const tor of tbTorrents) {
                            // Torrent non encore téléchargé : lecture impossible (HTTP 422 sur requestdl)
                            if (!isTorboxTorrentReady(tor)) continue;
                            if (
                                extractCleanTitle(tor.name || "")
                                    .title.toLowerCase()
                                    .includes(groupTitle.toLowerCase())
                            ) {
                                const files = tor.files || [];
                                const match = files.find(f => {
                                    const se = parseSeasonEpisode(f.name || f.filename || "");
                                    return se && se.season === season && se.episode === episode;
                                });
                                if (match) {
                                    streams.push(
                                        formatAioStream({
                                            filename: match.name || tor.name,
                                            sizeBytes: match.size || tor.size || 0,
                                            provider: "Mon Cloud",
                                            indexer: "Torbox Cloud",
                                            subtitle: "Épisode disponible dans votre compte Torbox",
                                            isInstant: true,
                                            cacheType: "cloud",
                                            isCloud: true,
                                            debridProvider: "torbox",
                                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/tb_cloud:${tor.id}:${match.id}`
                                        })
                                    );
                                }
                            }
                        }
                    }
                } catch (e) {}
            }
            if (hasAllDebrid && apiKey) {
                try {
                    const statusRes = await adGet("/v4.1/magnet/status", apiKey).catch(() => null);
                    const magnets =
                        (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
                    const matches = magnets.filter(m => {
                        // Magnet non prêt (téléchargement/erreur) ou déjà rejeté au clic : illisible
                        if (!alldebrid.isAllDebridMagnetReady(m) || alldebrid.isAllDebridTargetDead(m.id)) return false;
                        if (extractCleanTitle(m.filename || "").title.toLowerCase() !== groupTitle.toLowerCase())
                            return false;
                        const se = parseSeasonEpisode(m.filename || "");
                        return se && se.season === season && se.episode === episode;
                    });
                    for (const m of matches) {
                        streams.push(
                            formatAioStream({
                                filename: m.filename,
                                sizeBytes: m.size || 0,
                                provider: "Mon Cloud",
                                indexer: "AllDebrid Cloud",
                                subtitle: "Épisode disponible dans votre compte AllDebrid",
                                isInstant: true,
                                cacheType: "cloud",
                                isCloud: true,
                                debridProvider: "alldebrid",
                                url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${m.id}`
                            })
                        );
                    }
                } catch (e) {}
            }
        }
    }

    // 5. Film avec identifiant IMDb ("tt...") : vérification cache SQLite ou bibliothèque Cloud
    if (id.startsWith("tt") && !id.includes(":")) {
        // Vérification directe dans cache.movies (liens débridés, historique ou cloud)
        if (cache && cache.movies && Array.isArray(cache.movies[id])) {
            for (const v of cache.movies[id]) {
                if (v.link) {
                    streams.push(
                        formatAioStream({
                            filename: v.filename || "Fichier Débridé",
                            sizeBytes: v.size || 0,
                            provider: "Mon Cloud",
                            indexer: "AllDebrid Cloud",
                            subtitle: "Lien direct disponible dans votre Historique/Liens",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "alldebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(v.link)}`
                        })
                    );
                } else if (v.alldebridId && !alldebrid.isAllDebridTargetDead(v.alldebridId)) {
                    streams.push(
                        formatAioStream({
                            filename: v.filename || "Film Cloud",
                            sizeBytes: v.size || 0,
                            provider: "Mon Cloud",
                            indexer: "AllDebrid Cloud",
                            subtitle: "Film disponible dans votre compte AllDebrid",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "alldebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(v.alldebridId)}`
                        })
                    );
                } else if (v.tbRef) {
                    streams.push(
                        formatAioStream({
                            filename: v.filename || "Film Cloud",
                            sizeBytes: v.size || 0,
                            provider: "Mon Cloud",
                            indexer: "Torbox Cloud",
                            subtitle: "Film disponible dans votre compte Torbox",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "torbox",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/tb_cloud:${v.tbRef}`
                        })
                    );
                }
            }
        }

        if (hasAllDebrid) {
            const movieVersions = getMovieVersions(id);
            if (movieVersions && movieVersions.length > 0) {
                for (const v of movieVersions) {
                    // Cible déjà rejetée au clic (magnet non prêt/supprimé) : on cesse de la proposer
                    if (!v.alldebridId || alldebrid.isAllDebridTargetDead(v.alldebridId)) continue;
                    streams.push(
                        formatAioStream({
                            filename: v.filename,
                            sizeBytes: v.size || 0,
                            provider: "Mon Cloud",
                            indexer: "AllDebrid Cloud",
                            subtitle: "Film disponible dans votre compte AllDebrid",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "alldebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(v.alldebridId)}`
                        })
                    );
                }
            } else if (apiKey) {
                const title = searchTitle;
                if (title) {
                    try {
                        const statusRes = await adGet("/v4.1/magnet/status", apiKey).catch(() => null);
                        const magnets =
                            (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
                        const matches = magnets.filter(m => {
                            const c = extractCleanTitle(m.filename || "");
                            return (
                                isConfidentTitleMatch(title, c.title, searchYear, c.year) ||
                                (searchAltTitle && isConfidentTitleMatch(searchAltTitle, c.title, searchYear, c.year))
                            );
                        });
                        for (const m of matches) {
                            streams.push(
                                formatAioStream({
                                    filename: m.filename,
                                    sizeBytes: m.size || 0,
                                    provider: "Mon Cloud",
                                    indexer: "AllDebrid Cloud",
                                    subtitle: "Film disponible dans votre compte AllDebrid",
                                    isInstant: true,
                                    cacheType: "cloud",
                                    isCloud: true,
                                    debridProvider: "alldebrid",
                                    url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${m.id}`
                                })
                            );
                        }
                        if (matches.length > 0 && cache.movies) {
                            cache.movies[id] = matches.map(m => ({
                                alldebridId: m.id,
                                filename: m.filename,
                                size: m.size || 0
                            }));
                        }
                    } catch (e) {}
                }
            }
        }
        if (hasTorbox && activeTbApiKey) {
            const title = searchTitle;
            if (title) {
                try {
                    const { getTorboxTorrentList } = require("./torbox");
                    const tbTorrents = await getTorboxTorrentList(activeTbApiKey).catch(() => []);
                    if (Array.isArray(tbTorrents)) {
                        const matches = tbTorrents.filter(t => {
                            // Torrent non encore téléchargé : lecture impossible (HTTP 422 sur requestdl)
                            if (!isTorboxTorrentReady(t)) return false;
                            const c = extractCleanTitle(t.name || "");
                            return (
                                isConfidentTitleMatch(title, c.title, searchYear, c.year) ||
                                (searchAltTitle && isConfidentTitleMatch(searchAltTitle, c.title, searchYear, c.year))
                            );
                        });
                        for (const m of matches) {
                            streams.push(
                                formatAioStream({
                                    filename: m.name,
                                    sizeBytes: m.size || 0,
                                    provider: "Mon Cloud",
                                    indexer: "Torbox Cloud",
                                    subtitle: "Film disponible dans votre compte Torbox",
                                    isInstant: true,
                                    cacheType: "cloud",
                                    isCloud: true,
                                    debridProvider: "torbox",
                                    url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/tb_hash_${m.hash}`
                                })
                            );
                        }
                    }
                } catch (e) {}
            }
        }
    }

    // 6. Torrents pré-vérifiés en cache local par le worker Prowlarr
    let torboxInstantMap = {};
    let rdInstantMap = {};
    let dlInstantMap = {};
    const cachedTorrents = getCachedTorrentsByImdb(id);
    if (cachedTorrents && cachedTorrents.length > 0) {
        const hashes = cachedTorrents.map(t => t.infoHash);
        if (hasTorbox && activeTbApiKey) {
            try {
                const { checkInstantTorbox } = require("./torbox");
                torboxInstantMap = await checkInstantTorbox(hashes, activeTbApiKey);
            } catch (e) {}
        }
        if (hasRealDebrid && activeRdApiKey) {
            try {
                const { checkInstantRealDebrid } = require("./realdebrid");
                rdInstantMap = await checkInstantRealDebrid(hashes, activeRdApiKey);
            } catch (e) {}
        }
        if (hasDebridLink && activeDlApiKey) {
            try {
                const { checkInstantDebridLink } = require("./debridlink");
                dlInstantMap = await checkInstantDebridLink(hashes, activeDlApiKey);
            } catch (e) {}
        }

        for (const t of cachedTorrents) {
            const hLower = (t.infoHash || "").toLowerCase();
            if (!hLower || seenHashes.has(hLower)) continue;

            // Filtrage strict du titre et des suites/packs (ex: Toy Story 1 vs Toy Story 2/3/4 et packs)
            if (type === "movie" && searchTitle) {
                const tClean = extractCleanTitle(t.filename || t.title || "");
                const titleMatch =
                    isConfidentTitleMatch(searchTitle, tClean.title, searchYear, tClean.year) ||
                    (searchAltTitle && isConfidentTitleMatch(searchAltTitle, tClean.title, searchYear, tClean.year));
                if (!titleMatch) continue;
            }

            seenHashes.add(hLower);

            // Flux AllDebrid
            if (hasAllDebrid) {
                const isInstantAd = Boolean(t.isInstant);
                if (isInstantAd || config.allowDownload) {
                    const subtitle = isInstantAd
                        ? "⚡ Pré-cache RSS • AllDebrid"
                        : t.seeders
                          ? `🔍 Prowlarr Sync (${t.seeders} seeders) • Vérif. AllDebrid au clic`
                          : "🔍 Prowlarr Sync • Vérif. AllDebrid au clic";
                    streams.push(
                        formatAioStream({
                            filename: t.filename || t.title,
                            sizeBytes: t.size || 0,
                            seeders: t.seeders || 0,
                            provider: "Prowlio",
                            indexer: `Prowlarr | ${t.indexer || "Sync"}`,
                            cacheType: "precache",
                            subtitle,
                            isInstant: isInstantAd,
                            debridProvider: "alldebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/hash_${t.infoHash}`
                        })
                    );
                }
            }

            // Flux Real-Debrid
            if (hasRealDebrid) {
                const isInstantRd = Boolean(rdInstantMap[hLower]);
                if (isInstantRd || config.allowDownload) {
                    const subtitle = isInstantRd
                        ? "⚡ Instantané • Real-Debrid"
                        : t.seeders
                          ? `⏳ Téléchargement (${t.seeders} seeders)`
                          : "⏳ Téléchargement Real-Debrid";
                    streams.push(
                        formatAioStream({
                            filename: t.filename || t.title,
                            sizeBytes: t.size || 0,
                            seeders: t.seeders || 0,
                            provider: "Prowlio",
                            indexer: `Prowlarr | ${t.indexer || "Sync"}`,
                            cacheType: "precache",
                            subtitle,
                            isInstant: isInstantRd,
                            debridProvider: "realdebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/rd_hash_${t.infoHash}`
                        })
                    );
                }
            }

            // Flux Debrid-Link
            if (hasDebridLink) {
                const isInstantDl = Boolean(dlInstantMap[hLower]);
                if (isInstantDl || config.allowDownload) {
                    const subtitle = isInstantDl
                        ? "⚡ Instantané • Debrid-Link"
                        : t.seeders
                          ? `⏳ Téléchargement (${t.seeders} seeders)`
                          : "⏳ Téléchargement Debrid-Link";
                    streams.push(
                        formatAioStream({
                            filename: t.filename || t.title,
                            sizeBytes: t.size || 0,
                            seeders: t.seeders || 0,
                            provider: "Prowlio",
                            indexer: `Prowlarr | ${t.indexer || "Sync"}`,
                            cacheType: "precache",
                            subtitle,
                            isInstant: isInstantDl,
                            debridProvider: "debridlink",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/dl_hash_${t.infoHash}`
                        })
                    );
                }
            }

            // Flux Torbox
            if (hasTorbox) {
                const isInstantTb = Boolean(torboxInstantMap[hLower]);
                if (isInstantTb || config.allowDownload) {
                    const subtitle = isInstantTb
                        ? "⚡ Instantané • Torbox"
                        : t.seeders
                          ? `⏳ Téléchargement (${t.seeders} seeders)`
                          : "⏳ Téléchargement Torbox";
                    streams.push(
                        formatAioStream({
                            filename: t.filename || t.title,
                            sizeBytes: t.size || 0,
                            seeders: t.seeders || 0,
                            provider: "Prowlio",
                            indexer: `Prowlarr | ${t.indexer || "Sync"}`,
                            cacheType: "precache",
                            subtitle,
                            isInstant: isInstantTb,
                            debridProvider: "torbox",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/tb_hash_${t.infoHash}`
                        })
                    );
                }
            }
        }
    }

    // 7. Recherche à la demande Prowlarr et Lumio (mylumio.tv)
    const { recordSearchQuery } = require("./db");

    // La recherche à la demande utilise EXCLUSIVEMENT le Prowlarr de l'utilisateur.
    // L'instance du conteneur (.env) est réservée à la synchronisation RSS (qui alimente le cache
    // partagé pour tout le monde) et à son propriétaire, qui y accède avec sa propre clé.
    // Sans clé personnelle : aucune recherche à la demande, seuls les flux du cache RSS partagé.
    const hasOwnProwlarr = Boolean(
        config.prowlarrKey && config.prowlarrKey !== "off" && config.prowlarrKey.trim() !== ""
    );
    const prowlarrKey = hasOwnProwlarr ? config.prowlarrKey : "";
    const prowlarrUrl = config.prowlarrUrl || "";
    const prowlarrMode = config.prowlarrMode === "private" ? "private" : "shared";
    const isProwlarrConfigured = hasOwnProwlarr;

    if (cacheEnabled) {
        if (id.startsWith("kitsu:")) {
            const kitsuMeta = await resolveKitsuMeta(id, type);
            if (kitsuMeta) {
                searchTitle = kitsuMeta.name;
                searchYear = kitsuMeta.year || null;
                const mappedSeason = kitsuMeta.season || 1;
                if (kitsuMeta.episode) {
                    seasonNum = mappedSeason;
                    episodeNum = kitsuMeta.episode;
                }
                if (kitsuMeta.imdbId) {
                    effectiveImdbId = kitsuMeta.episode
                        ? `${kitsuMeta.imdbId}:${mappedSeason}:${kitsuMeta.episode}`
                        : kitsuMeta.imdbId;
                    const cachedTorrentsKitsu = getCachedTorrentsByImdb(effectiveImdbId);
                    if (cachedTorrentsKitsu && cachedTorrentsKitsu.length > 0) {
                        for (const t of cachedTorrentsKitsu) {
                            const hLower = (t.infoHash || "").toLowerCase();
                            if (!hLower || seenHashes.has(hLower)) continue;
                            const isInstant = isTorbox ? Boolean(torboxInstantMap[hLower]) : Boolean(t.isInstant);
                            if (!isInstant && !config.allowDownload) continue;
                            seenHashes.add(hLower);
                            const subtitle = isInstant
                                ? `⚡ Pré-cache RSS • ${debridName}`
                                : !isTorbox
                                  ? t.seeders
                                      ? `🔍 Prowlarr Sync (${t.seeders} seeders) • Vérif. AllDebrid au clic`
                                      : "🔍 Prowlarr Sync • Vérif. AllDebrid au clic"
                                  : t.seeders
                                    ? `⏳ Téléchargement (${t.seeders} seeders)`
                                    : `⏳ Téléchargement ${debridName}`;
                            const resolveTarget = isTorbox ? `tb_hash_${t.infoHash}` : `hash_${t.infoHash}`;
                            streams.push(
                                formatAioStream({
                                    filename: t.filename || t.title,
                                    sizeBytes: t.size || 0,
                                    seeders: t.seeders || 0,
                                    provider: "Prowlio",
                                    indexer: `Prowlarr | ${t.indexer || "Sync"}`,
                                    cacheType: "precache",
                                    subtitle,
                                    isInstant,
                                    debridProvider,
                                    url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${resolveTarget}`
                                })
                            );
                        }
                    }
                }
            }
        }

        // Enregistrement des statistiques de recherche dans SQLite
        if (searchTitle) {
            recordSearchQuery(effectiveImdbId || id, searchTitle, type);
        }

        const prowlarrPromise =
            isProwlarrConfigured && searchTitle
                ? searchProwlarrOnDemand({
                      id: effectiveImdbId,
                      type,
                      cleanTitle: searchTitle,
                      altTitle: searchAltTitle,
                      year: searchYear,
                      season: seasonNum,
                      episode: episodeNum,
                      prowlarrUrl,
                      prowlarrKey,
                      prowlarrMode,
                      apiKey
                  }).catch(() => [])
                : Promise.resolve([]);

        // Source externe Lumio : interrogation uniquement à la demande pour ce titre
        const lumioTargetId = effectiveImdbId.startsWith("tt")
            ? effectiveImdbId
            : id.startsWith("tt")
              ? id
              : id.startsWith("kitsu:")
                ? id
                : null;
        // Cible Torrentio : même identifiant que Lumio (IMDb, éventuellement "tt…:s:e")
        const torrentioTargetId = lumioTargetId;
        const torrentioType = type === "movie" ? "movie" : "series";
        let lumioEndpoint = null;
        if (lumioTargetId && config.lumioUrl && typeof config.lumioUrl === "string" && config.lumioUrl.trim() !== "") {
            const rawLumio = config.lumioUrl
                .trim()
                .replace(/\/manifest\.json$/i, "")
                .replace(/\/+$/, "");
            lumioEndpoint = `${rawLumio}/stream/${type}/${lumioTargetId}.json`;
        }

        const isLumioPaused = Date.now() < lumioDownUntil;
        const lumioPromise =
            lumioEndpoint && !isLumioPaused
                ? axios
                      .get(lumioEndpoint, {
                          headers: {
                              "User-Agent": BROWSER_UA,
                              Accept: "application/json"
                          },
                          timeout: 2500
                      })
                      .catch(err => {
                          const { logger } = require("./logger");
                          const isDown =
                              err.response && [502, 503, 521, 522, 523, 524, 530].includes(err.response.status);
                          const isTimeout =
                              err.code === "ECONNABORTED" || (err.message && err.message.includes("timeout"));
                          if (isDown || isTimeout) {
                              lumioDownUntil = Date.now() + 3 * 60 * 1000; // Mise en pause de 3 minutes pour préserver la fluidité
                              logger.warn(
                                  "Lumio",
                                  `Service injoignable (${err.response?.status || err.code || "Timeout"}). Pause temporaire de 3 minutes activée.`
                              );
                          } else {
                              logger.warn("Lumio", `Échec requête stream (${lumioTargetId}) : ${err.message}`);
                          }
                          return null;
                      })
                : Promise.resolve(null);

        // Source externe Torrentio : on n'exploite QUE les infoHash. La clé debrid de l'addon sert à la
        // lecture (jamais transmise à Torrentio). Les filtres Taille/Seed/Langue/Résolutions sont déjà
        // encodés dans l'URL de manifest collée par l'utilisateur.
        let torrentioEndpoint = null;
        if (
            torrentioTargetId &&
            config.torrentioUrl &&
            typeof config.torrentioUrl === "string" &&
            config.torrentioUrl.trim() !== ""
        ) {
            const rawTorrentio = config.torrentioUrl
                .trim()
                .replace(/\/manifest\.json$/i, "")
                .replace(/\/+$/, "");
            torrentioEndpoint = `${rawTorrentio}/stream/${torrentioType}/${torrentioTargetId}.json`;
        }

        const isTorrentioPaused = Date.now() < torrentioDownUntil;
        // Repli proxy ↔ direct : Cloudflare bloque les IP datacenter (403). L'ordre des tentatives
        // est réglable depuis l'admin (« direct » essaie l'IP du serveur en premier).
        const torrentioPrefer = config.torrentioEgress || getSystemSettings().torrentioEgress || "auto";
        const torrentioPromise =
            torrentioEndpoint && !isTorrentioPaused
                ? alldebrid
                      .fetchWithWarpFallback(
                          torrentioEndpoint,
                          {
                              headers: {
                                  "User-Agent": BROWSER_UA,
                                  Accept: "application/json",
                                  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"
                              },
                              timeout: 4000
                          },
                          undefined,
                          torrentioPrefer
                      )
                      .catch(err => {
                          const { logger } = require("./logger");
                          const detail = err.attemptsSummary ? ` [${err.attemptsSummary}]` : "";
                          const isDown =
                              err.response && [502, 503, 521, 522, 523, 524, 530].includes(err.response.status);
                          const isTimeout =
                              err.code === "ECONNABORTED" || (err.message && err.message.includes("timeout"));
                          if (isDown || isTimeout) {
                              torrentioDownUntil = Date.now() + 3 * 60 * 1000;
                              logger.warn(
                                  "Torrentio",
                                  `Service injoignable (${err.response?.status || err.code || "Timeout"})${detail}. Pause temporaire de 3 minutes activée.`
                              );
                          } else {
                              logger.warn(
                                  "Torrentio",
                                  `Échec requête stream (${torrentioTargetId}) : ${err.message}${detail}`
                              );
                          }
                          return null;
                      })
                : Promise.resolve(null);

        const jackettPromise =
            config.jackettUrl && config.jackettKey && searchTitle
                ? require("./jackett")
                      .searchJackettOnDemand({
                          cleanTitle: searchTitle,
                          year: searchYear,
                          season: seasonNum,
                          episode: episodeNum,
                          type,
                          jackettUrl: config.jackettUrl,
                          jackettKey: config.jackettKey
                      })
                      .catch(() => [])
                : Promise.resolve([]);

        const ddlPromise =
            config.ddlApiUrl && searchTitle
                ? require("./ddl-scraper")
                      .searchDdlLinks({
                          cleanTitle: searchTitle,
                          year: searchYear,
                          season: seasonNum,
                          episode: episodeNum,
                          type,
                          ddlApiUrl: config.ddlApiUrl
                      })
                      .catch(() => [])
                : Promise.resolve([]);

        const [prowlarrTorrents, lumioRes, torrentioRes, jackettTorrents, ddlLinks] = await Promise.all([
            prowlarrPromise,
            lumioPromise,
            torrentioPromise,
            jackettPromise,
            ddlPromise
        ]);

        // Normalisation des résultats Torrentio en torrents "type Prowlarr" — infoHash UNIQUEMENT
        // (l'`url` éventuelle de Torrentio est ignorée : la lecture passe par la clé de l'addon).
        const torrentioTorrents = [];
        const torrentioStreams =
            torrentioRes && torrentioRes.data && Array.isArray(torrentioRes.data.streams)
                ? torrentioRes.data.streams
                : [];
        for (const s of torrentioStreams) {
            if (!s || typeof s.infoHash !== "string") continue;
            const infoHash = s.infoHash.trim().toLowerCase();
            if (!/^[a-f0-9]{40}$/.test(infoHash)) continue;
            const titleStr = String(s.title || "");
            const filename = ((s.behaviorHints && s.behaviorHints.filename) || titleStr.split("\n")[0] || "").trim();
            // Ne garder que de vrais fichiers vidéo (écarte .zip/.srt/sample/bonus…)
            if (!filename || isExcludedArtifact(filename) || !isRealVideoFile(filename)) continue;
            const seedMatch = titleStr.match(/👤\s*(\d+)/);
            const idxMatch = titleStr.match(/⚙️\s*([^\n]+)/);
            torrentioTorrents.push({
                infoHash,
                filename,
                size: parseSizeFromString(titleStr) || 0,
                seeders: seedMatch ? parseInt(seedMatch[1], 10) : 0,
                indexer: idxMatch ? idxMatch[1].trim() : "",
                source: "torrentio"
            });
        }

        const externalTorrents = [
            ...(Array.isArray(prowlarrTorrents) ? prowlarrTorrents : []).map(t => ({ ...t, source: "prowlarr" })),
            ...(Array.isArray(jackettTorrents) ? jackettTorrents : []).map(t => ({ ...t, source: "jackett" })),
            ...torrentioTorrents
        ];

        if (externalTorrents.length > 0) {
            const prowlarrCacheType = prowlarrMode === "shared" ? "global" : "direct";
            // Vérification du cache instantané Torbox pour les torrents externes
            let torboxProwlarrInstantMap = {};
            if (hasTorbox && activeTbApiKey) {
                try {
                    const { checkInstantTorbox } = require("./torbox");
                    const hashes = externalTorrents.map(t => t.infoHash);
                    torboxProwlarrInstantMap = await checkInstantTorbox(hashes, activeTbApiKey);
                } catch (e) {}
            }

            // Vérification du cache instantané Real-Debrid pour les torrents externes
            let rdProwlarrInstantMap = {};
            if (hasRealDebrid && activeRdApiKey) {
                try {
                    const { checkInstantRealDebrid } = require("./realdebrid");
                    const hashes = externalTorrents.map(t => t.infoHash);
                    rdProwlarrInstantMap = await checkInstantRealDebrid(hashes, activeRdApiKey);
                } catch (e) {}
            }

            // Vérification du cache instantané Debrid-Link pour les torrents externes
            let dlProwlarrInstantMap = {};
            if (hasDebridLink && activeDlApiKey) {
                try {
                    const { checkInstantDebridLink } = require("./debridlink");
                    const hashes = externalTorrents.map(t => t.infoHash);
                    dlProwlarrInstantMap = await checkInstantDebridLink(hashes, activeDlApiKey);
                } catch (e) {}
            }

            // Pré-validation active du cache AllDebrid pour les torrents externes.
            const rankedForProbe = [...externalTorrents].sort(
                (a, b) => Number(b.seeders) - Number(a.seeders) || Number(b.size) - Number(a.size)
            );
            let readOnlyInstantMap = {};
            if (hasAllDebrid && apiKey && config.preValidateCache !== false) {
                try {
                    const { checkInstantMagnets } = require("./alldebrid");
                    const roHashes = [];
                    for (const t of rankedForProbe) {
                        const h = (t.infoHash || "").toLowerCase();
                        if (h && !roHashes.includes(h)) roHashes.push(h);
                        if (roHashes.length >= 40) break;
                    }
                    if (roHashes.length > 0) {
                        const roMap = await checkInstantMagnets(roHashes, apiKey);
                        if (roMap && typeof roMap === "object") {
                            for (const [h, v] of Object.entries(roMap)) {
                                if (v) readOnlyInstantMap[String(h).toLowerCase()] = true;
                            }
                        }
                    }
                } catch (e) {}
            }
            let alldebridProwlarrInstantMap = {};
            if (hasAllDebrid && apiKey && config.preValidateCache !== false) {
                try {
                    const { preValidateMagnets } = require("./alldebrid");
                    alldebridProwlarrInstantMap = await preValidateMagnets(rankedForProbe, apiKey, {
                        maxProbes: 12,
                        imdbId: id
                    });
                } catch (e) {}
            }

            for (const t of externalTorrents) {
                const hLower = (t.infoHash || "").toLowerCase();
                if (!hLower || seenHashes.has(hLower)) continue;
                seenHashes.add(hLower);

                const isTorrentio = t.source === "torrentio";
                const isJackett = t.source === "jackett";
                const sourcePrefix = isTorrentio ? "Torrentio" : isJackett ? "Jackett" : "Prowlarr";
                const indexerLabel = `${sourcePrefix} | ${t.indexer || "Recherche"}`;

                // Flux AllDebrid
                if (hasAllDebrid) {
                    const isInstantAd = Boolean(
                        t.isInstant || readOnlyInstantMap[hLower] || alldebridProwlarrInstantMap[hLower]
                    );
                    const wasProbed =
                        hLower in readOnlyInstantMap || hLower in alldebridProwlarrInstantMap || Boolean(t.isInstant);

                    let subtitle;
                    let cacheType;
                    let statusTag;
                    if (isInstantAd) {
                        if (isTorrentio) {
                            subtitle = "⚡ Instantané Torrentio • AllDebrid";
                            cacheType = "torrentio";
                            statusTag = "[AD ⚡ Torrentio]";
                        } else {
                            subtitle =
                                prowlarrMode === "shared" ? "⚡ Cache Global (Mutualisé)" : "⚡ Instantané AllDebrid";
                            cacheType = "global";
                        }
                    } else if (wasProbed) {
                        subtitle = t.seeders
                            ? `⏳ Téléchargement (${t.seeders} seeders)`
                            : "⏳ Téléchargement AllDebrid";
                        cacheType = "download";
                    } else if (isTorrentio) {
                        subtitle = t.seeders
                            ? `🔍 Torrentio (${t.seeders} seeders) • Vérif. AllDebrid au clic`
                            : "🔍 Torrentio • Vérif. AllDebrid au clic";
                        cacheType = "torrentio";
                        statusTag = "[AD 🔍 Torrentio]";
                    } else {
                        subtitle = t.seeders
                            ? `🔍 ${sourcePrefix} (${t.seeders} seeders) • Vérif. AllDebrid au clic`
                            : `🔍 ${sourcePrefix} • Vérif. AllDebrid au clic`;
                        cacheType = prowlarrCacheType;
                    }

                    if (isInstantAd || config.allowDownload) {
                        streams.push(
                            formatAioStream({
                                filename: t.filename || t.title,
                                sizeBytes: t.size || 0,
                                seeders: t.seeders || 0,
                                provider: "Prowlio",
                                indexer: indexerLabel,
                                cacheType,
                                subtitle,
                                statusTag,
                                isInstant: isInstantAd,
                                debridProvider: "alldebrid",
                                url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/hash_${t.infoHash}`
                            })
                        );
                    }
                }

                // Flux Real-Debrid
                if (hasRealDebrid) {
                    const isInstantRd = Boolean(rdProwlarrInstantMap[hLower]);
                    const subtitle = isInstantRd
                        ? isTorrentio
                            ? "⚡ Instantané Torrentio • Real-Debrid"
                            : "⚡ Instantané • Real-Debrid"
                        : t.seeders
                          ? `⏳ Téléchargement (${t.seeders} seeders)`
                          : "⏳ Téléchargement Real-Debrid";
                    if (isInstantRd || config.allowDownload) {
                        streams.push(
                            formatAioStream({
                                filename: t.filename || t.title,
                                sizeBytes: t.size || 0,
                                seeders: t.seeders || 0,
                                provider: "Prowlio",
                                indexer: indexerLabel,
                                cacheType: isTorrentio ? "torrentio" : prowlarrCacheType,
                                subtitle,
                                isInstant: isInstantRd,
                                debridProvider: "realdebrid",
                                url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/rd_hash_${t.infoHash}`
                            })
                        );
                    }
                }

                // Flux Debrid-Link
                if (hasDebridLink) {
                    const isInstantDl = Boolean(dlProwlarrInstantMap[hLower]);
                    const subtitle = isInstantDl
                        ? isTorrentio
                            ? "⚡ Instantané Torrentio • Debrid-Link"
                            : "⚡ Instantané • Debrid-Link"
                        : t.seeders
                          ? `⏳ Téléchargement (${t.seeders} seeders)`
                          : "⏳ Téléchargement Debrid-Link";
                    if (isInstantDl || config.allowDownload) {
                        streams.push(
                            formatAioStream({
                                filename: t.filename || t.title,
                                sizeBytes: t.size || 0,
                                seeders: t.seeders || 0,
                                provider: "Prowlio",
                                indexer: indexerLabel,
                                cacheType: isTorrentio ? "torrentio" : prowlarrCacheType,
                                subtitle,
                                isInstant: isInstantDl,
                                debridProvider: "debridlink",
                                url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/dl_hash_${t.infoHash}`
                            })
                        );
                    }
                }

                // Flux Torbox
                if (hasTorbox) {
                    const isInstantTb = Boolean(torboxProwlarrInstantMap[hLower]);
                    const subtitle = isInstantTb
                        ? isTorrentio
                            ? "⚡ Instantané Torrentio • Torbox"
                            : "⚡ Instantané • Torbox"
                        : t.seeders
                          ? `⏳ Téléchargement (${t.seeders} seeders)`
                          : isTorrentio
                            ? "⏳ Téléchargement Torrentio • Torbox"
                            : "⏳ Téléchargement Torbox";
                    if (isInstantTb || config.allowDownload) {
                        streams.push(
                            formatAioStream({
                                filename: t.filename || t.title,
                                sizeBytes: t.size || 0,
                                seeders: t.seeders || 0,
                                provider: "Prowlio",
                                indexer: indexerLabel,
                                cacheType: isTorrentio ? "torrentio" : prowlarrCacheType,
                                subtitle,
                                statusTag: isTorrentio
                                    ? isInstantTb
                                        ? "[TB ⚡ Torrentio]"
                                        : "[TB 🔍 Torrentio]"
                                    : undefined,
                                isInstant: isInstantTb,
                                debridProvider: "torbox",
                                url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/tb_hash_${t.infoHash}`
                            })
                        );
                    }
                }
            }
        }

        const lumioStreams =
            lumioRes && lumioRes.data && Array.isArray(lumioRes.data.streams) ? lumioRes.data.streams : [];
        if (lumioStreams.length > 0) {
            const seenLumioUrls = new Set();
            for (const s of lumioStreams) {
                if (!s || !s.url || typeof s.url !== "string" || !s.url.startsWith("http")) continue;
                if (s.name && (s.name.includes("🔴") || s.name.toLowerCase().includes("aucune source"))) continue;
                if (s.description && s.description.toLowerCase().includes("aucune source trouvée")) continue;
                if (seenLumioUrls.has(s.url)) continue;
                seenLumioUrls.add(s.url);

                const fname =
                    s.behaviorHints?.filename ||
                    (s.description || "")
                        .split("\n")
                        .find(l => /\b(1080p|720p|2160p|4k|bluray|web[\.\-]?dl|hevc|x264)\b/i.test(l)) ||
                    s.title ||
                    "Flux Lumio";

                const sizeBytes =
                    s.behaviorHints?.videoSize || parseSizeFromString(s.description || s.title || "") || 0;

                let lumioIndexer = "Lumio";
                if (s.description) {
                    const matchIdx = s.description.match(/🔎\s*([^\n\r]+)/);
                    if (matchIdx && matchIdx[1]) {
                        lumioIndexer = `Lumio | ${matchIdx[1].trim()}`;
                    }
                }

                const streamHasTb = Boolean(s.name && s.name.includes("TB"));
                const streamHasAd = Boolean(s.name && s.name.includes("AD"));
                const lumioProvider = streamHasTb ? "torbox" : streamHasAd ? "alldebrid" : debridProvider;
                const lumioDebridTag = lumioProvider === "torbox" ? "TB" : "AD";
                const lumioDebridName = lumioProvider === "torbox" ? "Torbox" : "AllDebrid";
                const lumioTag = `[${lumioDebridTag} ⚡ Lumio]`;

                streams.push(
                    formatAioStream({
                        filename: fname,
                        sizeBytes: sizeBytes,
                        provider: "Lumio",
                        indexer: lumioIndexer,
                        cacheType: "lumio",
                        statusTag: lumioTag,
                        subtitle: `⚡ Instantané Lumio • ${lumioDebridName}`,
                        isInstant: true,
                        debridProvider: lumioProvider,
                        url: s.url
                    })
                );
            }
        }

        if (Array.isArray(ddlLinks) && ddlLinks.length > 0) {
            const { encodeDdlTarget } = require("./ddl-scraper");
            const seenDdlUrls = new Set();
            for (const ddl of ddlLinks) {
                if (!ddl || !ddl.url || seenDdlUrls.has(ddl.url)) continue;
                seenDdlUrls.add(ddl.url);
                const fname = ddl.filename || ddl.title || `${searchTitle || "DDL"} [${ddl.host || "Direct"}]`;
                const sizeBytes =
                    typeof ddl.size === "number" ? ddl.size : parseSizeFromString(String(ddl.size || "")) || 0;
                const hostLabel = ddl.host ? `DDL | ${ddl.host}` : "DDL Direct";
                const ddlProv =
                    debridProvider === "multi"
                        ? hasAllDebrid
                            ? "alldebrid"
                            : hasRealDebrid
                              ? "realdebrid"
                              : hasDebridLink
                                ? "debridlink"
                                : "alldebrid"
                        : debridProvider;
                streams.push(
                    formatAioStream({
                        filename: fname,
                        sizeBytes,
                        provider: "Prowlio",
                        indexer: hostLabel,
                        cacheType: "direct",
                        subtitle: `⚡ DDL Direct • ${ddl.host || "Téléchargement Direct"}`,
                        isInstant: true,
                        debridProvider: ddlProv,
                        url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeDdlTarget(ddl.url)}`
                    })
                );
            }
        }
    }

    if (userRef) {
        asyncTouchUserActivity(userRef);
    }

    return {
        streams: filterAndSortStreams(streams, {
            resolutions: config.resolutions,
            langPref: langPrefArray,
            hideUnknownLanguages: Boolean(config.hideUnknownLanguages),
            maxSizeGb: config.maxSizeGb,
            sortBy: config.sortBy,
            maxStreams: config.maxStreams
        })
    };
}

module.exports = {
    handleManifest,
    handleMeta,
    handleCatalog,
    handleStream
};
