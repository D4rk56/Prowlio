"use strict";

/**
 * @file titleResolver.js
 * @description Module de résolution et de matching TMDB universel et robuste pour Prowlio.
 * Prise en charge optimisée pour :
 *  - Animés : Noms fansub complexes, titres Romaji / alternatifs (Anitomy-js existant)
 *  - Films : Balises warez/scène, titres bilingues, chiffres romains (II <-> 2), reboots
 *  - Séries : Séparation show vs épisode/saison, désambiguïsation par année
 *
 * Pipeline :
 *  1. Vérification du cache 30 jours (LRU mémoire L1 + persistance SQLite L2)
 *  2. Parsing hybride (Anitomy pour animés, extractCleanTitle pour films/séries)
 *  3. Nettoyage pré-requête TMDB (ponctuation bloquante, préservation chiffres romains)
 *  4. Recherche TMDB multi-passes avec tmdb-kit (/search/multi, sans année, /tv & /movie séparés)
 *  5. Scoring multi-critères (Titre FR, Titre VO, alias TMDB, bonus type & année, pénalités suites/packs)
 *  6. Sélection (seuil de confiance 0.85 ou retour des N meilleurs candidats triés)
 */

const { createTMDB } = require("tmdb-kit");
const stringSimilarity = require("string-similarity");
const crypto = require("node:crypto");

const { parseAnimeTitle, normalizeAnimeTitle, extractSeasonModifiers } = require("./animeParser");

const {
    extractCleanTitle,
    parseSeasonEpisode,
    cleanUrlAndDomainPrefix,
    makeLRU,
    TMDB_KEY_DEFAULT
} = require("./helpers");

const { getTmdbResolution, saveTmdbResolution } = require("./db");

// =============================================================================
// CACHES L1 (MÉMOIRE) POUR LES RÉSOLUTIONS ET TITRES ALTERNATIFS
// =============================================================================

// Cache mémoire L1 des résolutions complètes (1h)
const resolutionMemoryLRU = makeLRU(2000, 3600_000);

// Cache mémoire des titres alternatifs TMDB par média (24h)
const altTitlesCache = makeLRU(1500, 24 * 3600_000);

// Seuil de confiance minimal pour sélection directe sans ambiguïté
const CONFIDENCE_THRESHOLD = 0.85;

// Nombre maximum de candidats retournés en cas d'ambiguïté
const MAX_CANDIDATES_RETURNED = 5;

// Pénalité appliquée pour une suite/franchise non demandée (ex: Shippuden, Part 2)
const SEQUEL_PENALTY = 0.3;

// Pénalité appliquée pour un coffret / intégrale / pack multi-films
const PACK_PENALTY = 0.3;

// =============================================================================
// CONSTANTES ET MOTIFS DE NORMALISATION
// =============================================================================

const ROMAN_NUMERALS_MAP = {
    x: 10,
    ix: 9,
    viii: 8,
    vii: 7,
    vi: 6,
    v: 5,
    iv: 4,
    iii: 3,
    ii: 2,
    i: 1
};

const SEQUEL_MODIFIERS = [
    "shippuden",
    "shippuuden",
    "brotherhood",
    "next generations",
    "super",
    "gt",
    "part 2",
    "part ii",
    "part 3",
    "part iii",
    "part 4",
    "part iv",
    "chapter 2",
    "chapter 3",
    "2nd season",
    "3rd season",
    "final season",
    "cour 2",
    "cour 1",
    "reloaded",
    "revolutions",
    "resurrection",
    "awakens",
    "legacy",
    "returns"
];

const PACK_PATTERNS =
    /\b(trilogie|trilogy|quadrilogie|quadrilogy|integrale|int[ée]gra?le|boxset|collection|anthology|pack|complete)\b/i;

// =============================================================================
// UTILITAIRES DE NORMALISATION ET SCORING
// =============================================================================

/**
 * Normalise les chiffres romains en chiffres arabes pour un matching équitable
 * Ex: "Gladiator II" -> "Gladiator 2", "Fast & Furious X" -> "Fast & Furious 10"
 * @param {string} str - Chaîne à normaliser
 * @returns {string}
 */
function normalizeRomanNumerals(str) {
    if (!str || typeof str !== "string") return "";
    return str.replace(/\b(x|ix|viii|vii|vi|v|iv|iii|ii|i)\b/gi, match => {
        const val = ROMAN_NUMERALS_MAP[match.toLowerCase()];
        return val ? String(val) : match;
    });
}

/**
 * Normalise les nombres écrits en toutes lettres après les termes de parties/saisons
 * Ex: "Part Two" -> "Part 2", "Deuxième Partie" -> "Part 2"
 * @param {string} str
 * @returns {string}
 */
function normalizeWrittenNumbers(str) {
    if (!str || typeof str !== "string") return "";
    const WORD_TO_NUM = {
        one: "1",
        un: "1",
        une: "1",
        premiere: "1",
        two: "2",
        deux: "2",
        deuxieme: "2",
        three: "3",
        trois: "3",
        troisieme: "3",
        four: "4",
        quatre: "4",
        quatrieme: "4",
        five: "5",
        cinq: "5",
        cinquieme: "5"
    };
    return str
        .replace(
            /\b(part|partie|cour|season|saison|chapter|chapitre)\s+(one|two|three|four|five|un|une|premiere|deux|deuxieme|trois|troisieme|quatre|quatrieme|cinq|cinquieme)\b/gi,
            (m, p1, p2) => {
                const num = WORD_TO_NUM[p2.toLowerCase()] || p2;
                return `${p1.toLowerCase()} ${num}`;
            }
        )
        .replace(/\b(partie|cour|saison|chapitre)\s+(\d+)\b/gi, (m, p1, p2) => `part ${p2}`);
}

/**
 * Nettoie et normalise universellement un titre pour la comparaison textuelle floue :
 * - Suppression des accents et caractères de contrôle (NFKD)
 * - Conversion des chiffres romains en chiffres arabes
 * - Normalisation des termes de parties ("Part Two" -> "Part 2")
 * - Remplacement de la ponctuation par des espaces
 * - Minuscules et espaces uniques
 *
 * @param {string} title - Titre à normaliser
 * @returns {string}
 */
function normalizeForComparison(title) {
    if (!title || typeof title !== "string") return "";
    let s = title.trim();

    // Normalisation romaji / kana préalable si applicable
    s = normalizeAnimeTitle(s);

    // Normalisation des chiffres romains
    s = normalizeRomanNumerals(s);

    // Normalisation des nombres écrits en lettres (Part Two -> Part 2)
    s = normalizeWrittenNumbers(s);

    // Unicode NFKD et suppression des diacritiques
    s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

    // Remplacement de la ponctuation
    s = s.replace(/['’`´]/g, "");
    s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");

    return s
        .toLowerCase()
        .replace(/\s{2,}/g, " ")
        .trim();
}

/**
 * Détecte les modificateurs de suite (sequels / spin-offs) présents dans une chaîne normalisée.
 * @param {string} normStr - Titre normalisé
 * @returns {Set<string>}
 */
function detectSequelModifiers(normStr) {
    const found = new Set();
    if (!normStr) return found;
    for (const mod of SEQUEL_MODIFIERS) {
        const pattern = new RegExp(`\\b${mod}\\b`, "i");
        if (pattern.test(normStr)) {
            found.add(mod);
        }
    }
    // Détection "part \d"
    const partMatch = normStr.match(/\bpart\s+(\d+)\b/);
    if (partMatch) {
        found.add(`part ${partMatch[1]}`);
        found.add(partMatch[1]);
    } else {
        const numMatch = normStr.match(/\b([2-9])\b/);
        if (numMatch) {
            found.add(numMatch[1]);
        }
    }
    return found;
}

/**
 * Vérifie si une chaîne comporte des signaux caractéristiques d'un animé
 * (groupes fansub entre crochets, termes VOSTFR, caractères CJK, etc.)
 * @param {string} filename
 * @returns {boolean}
 */
function isAnimeSignal(filename) {
    if (!filename || typeof filename !== "string") return false;
    return (
        /^\[[^\]]+\]/.test(filename) ||
        /\b(vostfr|fansub|anidb|kitsu|myanimelist)\b/i.test(filename) ||
        /[\u3040-\u30ff\u4e00-\u9faf]/u.test(filename)
    );
}

/**
 * Prépare la requête de recherche nettoyée pour TMDB à partir du titre brut.
 * @param {string} rawTitle - Nom de fichier ou titre brut
 * @param {Object} [options={}]
 * @returns {{ primaryQuery: string, altQueries: string[], detectedYear: number|null, preferredType: 'tv'|'movie'|null, isAnime: boolean }}
 */
function extractQueryAndMetadata(rawTitle, options = {}) {
    const cleanedRaw = cleanUrlAndDomainPrefix(rawTitle || "");
    const animeDetected = isAnimeSignal(cleanedRaw);

    let primaryQuery = "";
    const altQueries = [];
    let detectedYear = options.year ? parseInt(options.year, 10) : null;
    let detectedSeason = null;
    let hasSeriesSignal = false;

    // 1. Parsing spécifique pour les animés
    if (animeDetected) {
        const animeParsed = parseAnimeTitle(cleanedRaw);
        if (animeParsed && animeParsed.title) {
            primaryQuery = animeParsed.baseTitle || animeParsed.title;
            if (animeParsed.title && animeParsed.title !== primaryQuery) {
                altQueries.push(animeParsed.title);
            }
            if (Array.isArray(animeParsed.altTitles)) {
                for (const alt of animeParsed.altTitles) {
                    if (alt && !altQueries.includes(alt)) altQueries.push(alt);
                }
            }
            if (animeParsed.year && !detectedYear) {
                detectedYear = animeParsed.year;
            }
            if (animeParsed.season > 1 || animeParsed.episode !== null) {
                hasSeriesSignal = true;
            }
            if (animeParsed.isMovie) {
                hasSeriesSignal = false;
            }
        }
    }

    // 2. Parsing général pour les films et séries (ou si Anitomy n'a pas donné de titre significatif)
    if (!primaryQuery || primaryQuery.length < 2) {
        const stdClean = extractCleanTitle(cleanedRaw);
        const se = parseSeasonEpisode(cleanedRaw);

        primaryQuery = stdClean.title;
        if (stdClean.altTitle && !altQueries.includes(stdClean.altTitle)) {
            altQueries.push(stdClean.altTitle);
        }
        if (stdClean.year && !detectedYear) {
            const py = parseInt(stdClean.year, 10);
            if (!isNaN(py)) detectedYear = py;
        }
        if (se !== null || (stdClean.title && /\b(season|saison|s\d+)\b/i.test(cleanedRaw))) {
            hasSeriesSignal = true;
        }
    }

    // 3. Nettoyage des suffixes de saison dans le titre principal (ex: "Severance Season 2" -> "Severance")
    if (primaryQuery) {
        const { baseTitle, detectedSeason: sNum } = extractSeasonModifiers(primaryQuery);
        if (baseTitle && baseTitle !== primaryQuery) {
            primaryQuery = baseTitle;
            hasSeriesSignal = true;
        }
        if (sNum) detectedSeason = sNum;
    }

    // 4. Nettoyage des caractères problématiques pour TMDB (:, ;, & remplacés par des espaces)
    const sanitizeForTmdb = s =>
        s
            .replace(/[:;&]/g, " ")
            .replace(/[\._]+/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim();

    primaryQuery = sanitizeForTmdb(primaryQuery || cleanedRaw);
    const sanitizedAlts = altQueries.map(sanitizeForTmdb).filter(Boolean);

    // Détermination du type préféré
    let preferredType = options.preferredType || null;
    if (!preferredType) {
        if (hasSeriesSignal) preferredType = "tv";
        else if (options.isMovie || (!hasSeriesSignal && detectedYear && !animeDetected)) {
            preferredType = "movie";
        }
    }

    return {
        primaryQuery,
        altQueries: sanitizedAlts,
        detectedYear: !isNaN(detectedYear) && detectedYear > 1900 ? detectedYear : null,
        detectedSeason,
        preferredType,
        isAnime: animeDetected
    };
}

// =============================================================================
// EXÉCUTEUR AVEC RETRIES SUR 5XX ET 429
// =============================================================================

/**
 * Exécute une fonction asynchrone avec retry exponentiel sur les erreurs 5xx et 429 uniquement.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} [maxRetries=2]
 * @returns {Promise<T>}
 */
async function callWithRetry(fn, maxRetries = 2) {
    let attempt = 0;
    while (attempt <= maxRetries) {
        try {
            return await fn();
        } catch (err) {
            const status = err.status || (err.response && err.response.status) || 0;
            const isRetryable = status === 429 || (status >= 500 && status <= 599);

            if (isRetryable && attempt < maxRetries) {
                attempt++;
                const delayMs = attempt === 1 ? 500 : 1500;
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }
            throw err;
        }
    }
}

// =============================================================================
// RÉCUPÉRATION DES TITRES ALTERNATIFS TMDB
// =============================================================================

/**
 * Récupère les titres alternatifs d'un média TMDB (avec cache mémoire 24h).
 * @param {Object} tmdbClient
 * @param {'tv'|'movie'} mediaType
 * @param {number} tmdbId
 * @returns {Promise<string[]>}
 */
async function fetchTmdbAlternativeTitles(tmdbClient, mediaType, tmdbId) {
    if (!tmdbClient || !tmdbId || !mediaType) return [];
    const cacheKey = `alt_${mediaType}_${tmdbId}`;
    if (altTitlesCache.has(cacheKey)) {
        return altTitlesCache.get(cacheKey);
    }

    try {
        const path = `/${mediaType}/${encodeURIComponent(tmdbId)}/alternative_titles`;
        const res = await callWithRetry(() => tmdbClient.request(path)).catch(() => null);

        const titles = [];
        const rawList = res?.titles || res?.results || [];
        if (Array.isArray(rawList)) {
            for (const item of rawList) {
                if (item && item.title && typeof item.title === "string") {
                    titles.push(item.title.trim());
                }
            }
        }

        altTitlesCache.set(cacheKey, titles);
        return titles;
    } catch (e) {
        altTitlesCache.set(cacheKey, []);
        return [];
    }
}

// =============================================================================
// CALCUL DU SCORE DE SIMILARITÉ ET PÉNALITÉS
// =============================================================================

/**
 * Calcule le score de confiance entre une requête et un candidat TMDB.
 * @param {Object} candidate - Objet candidat TMDB (movie ou tv)
 * @param {string[]} queryTitles - Ensemble des titres extraits de la requête
 * @param {Object} meta - Métadonnées de recherche (detectedYear, preferredType)
 * @param {string[]} tmdbAlternativeTitles - Alias TMDB récupérés
 * @returns {number} Score compris entre 0.0 et 1.0
 */
function scoreCandidate(candidate, queryTitles, meta, tmdbAlternativeTitles = []) {
    if (!candidate || !queryTitles || queryTitles.length === 0) return 0;

    const candTitleFr = candidate.title || candidate.name || "";
    const candTitleOrig = candidate.original_title || candidate.original_name || "";

    const candTitlesToCompare = [candTitleFr, candTitleOrig, ...tmdbAlternativeTitles]
        .filter(Boolean)
        .map(normalizeForComparison);

    const normQueries = queryTitles.map(normalizeForComparison).filter(Boolean);

    // 1. Calcul du meilleur score de similarité textuelle
    let maxSimilarity = 0;
    let bestQ = normQueries[0] || "";
    let bestC = candTitlesToCompare[0] || "";

    for (const q of normQueries) {
        for (const c of candTitlesToCompare) {
            if (q === c) {
                maxSimilarity = 1.0;
                bestQ = q;
                bestC = c;
                break;
            }
            try {
                const sim = stringSimilarity.compareTwoStrings(q, c);
                if (sim > maxSimilarity) {
                    maxSimilarity = sim;
                    bestQ = q;
                    bestC = c;
                }
            } catch (e) {}
        }
        if (maxSimilarity >= 1.0) break;
    }

    let finalScore = maxSimilarity;

    // 2. Bonus type de média
    const candMediaType = candidate.media_type === "tv" ? "tv" : "movie";
    if (meta.preferredType && candMediaType === meta.preferredType) {
        finalScore += 0.05;
    }

    // 3. Bonus ou pénalité d'année
    const candDate = candidate.release_date || candidate.first_air_date || "";
    const candYear = parseInt(candDate.slice(0, 4), 10);

    if (meta.detectedYear && !isNaN(candYear)) {
        const diff = Math.abs(candYear - meta.detectedYear);
        if (diff === 0) {
            finalScore += 0.05;
        } else if (diff === 1) {
            finalScore += 0.02;
        } else if (candMediaType === "movie") {
            // Pour les films, tout écart d'année >= 2 ans est pénalisé
            finalScore -= Math.min(0.25, 0.05 * diff);
        } else if (candMediaType === "tv") {
            // Pour les séries TV :
            // - Si le show a commencé APRÈS l'année de la release : impossible, pénalité sévère
            if (candYear > meta.detectedYear + 1) {
                finalScore -= Math.min(0.25, 0.05 * (candYear - meta.detectedYear));
            } else if (meta.detectedYear - candYear > 25) {
                // Écart de plus de 25 ans (reboot rétro vs show contemporain, ex: 1963 vs 2005)
                finalScore -= 0.2;
            }
            // Si le show a commencé quelques années avant (ex: 2013 pour une saison finale 2020), c'est une saison ultérieure : pas de pénalité
        }
    }

    // 4. Pénalité stricte de suite / franchise non mentionnée
    // Ex: "Naruto" vs "Naruto Shippuden", "Dune" vs "Dune: Part Two", "Gladiator" vs "Gladiator 2"
    const qModifiers = detectSequelModifiers(bestQ);
    const cModifiers = detectSequelModifiers(bestC);

    let hasSequelMismatch = false;
    for (const m of cModifiers) {
        if (!qModifiers.has(m)) {
            hasSequelMismatch = true;
            break;
        }
    }
    if (!hasSequelMismatch) {
        for (const m of qModifiers) {
            if (!cModifiers.has(m)) {
                hasSequelMismatch = true;
                break;
            }
        }
    }

    if (hasSequelMismatch) {
        finalScore -= SEQUEL_PENALTY;
    }

    // 5. Pénalité pour coffrets / packs
    const candHasPack = PACK_PATTERNS.test(candTitleFr) || PACK_PATTERNS.test(candTitleOrig);
    const queryHasPack = normQueries.some(q => PACK_PATTERNS.test(q));
    if (candHasPack && !queryHasPack) {
        finalScore -= PACK_PENALTY;
    }

    return parseFloat(Math.max(0, Math.min(1.0, finalScore)).toFixed(4));
}

// =============================================================================
// RECHERCHE MULTI-PASSES TMDB
// =============================================================================

/**
 * Lance la recherche multi-passes sur TMDB à l'aide de tmdb-kit.
 * @param {Object} tmdbClient
 * @param {string} query
 * @param {Object} meta
 * @param {string} language
 * @returns {Promise<Object[]>} Liste de candidats uniques
 */
async function searchMultiPass(tmdbClient, query, meta, language) {
    if (!tmdbClient || !query || query.length < 2) return [];

    const candidatesMap = new Map();
    const addCandidates = (results, forcedType = null) => {
        if (!Array.isArray(results)) return;
        for (const r of results) {
            const mType = forcedType || r.media_type;
            if (mType !== "movie" && mType !== "tv") continue;
            const key = `${mType}_${r.id}`;
            if (!candidatesMap.has(key)) {
                candidatesMap.set(key, { ...r, media_type: mType });
            }
        }
    };

    // Passe 1 : /search/multi avec query + language (+ year si film ou première date si série)
    try {
        const params = { query, language, page: 1 };
        const res = await callWithRetry(() => tmdbClient.search.multi(params)).catch(() => null);
        addCandidates(res?.results);
    } catch (e) {}

    // Passe 2 : si aucun résultat et qu'une année était détectée, réessayer sans restriction
    if (candidatesMap.size === 0 && meta.detectedYear) {
        try {
            const resNoYear = await callWithRetry(() => tmdbClient.search.multi({ query, language, page: 1 })).catch(
                () => null
            );
            addCandidates(resNoYear?.results);
        } catch (e) {}
    }

    // Passe 3 : si toujours 0 résultat, interroger /search/tv et /search/movie séparément
    if (candidatesMap.size === 0) {
        try {
            const firstSearch = meta.preferredType === "tv" ? "tv" : "movies";
            const secondSearch = firstSearch === "tv" ? "movies" : "tv";

            const res1 = await callWithRetry(() => tmdbClient.search[firstSearch]({ query, language, page: 1 })).catch(
                () => null
            );
            addCandidates(res1?.results, firstSearch === "tv" ? "tv" : "movie");

            if (candidatesMap.size < 5) {
                const res2 = await callWithRetry(() =>
                    tmdbClient.search[secondSearch]({ query, language, page: 1 })
                ).catch(() => null);
                addCandidates(res2?.results, secondSearch === "tv" ? "tv" : "movie");
            }
        } catch (e) {}
    }

    // Passe 4 : Si toujours 0 et que le titre est composé (ex: "Alien: Romulus" ou "RWBY Hyousetsu Teikoku"),
    // tenter sur la clause principale (ex: les 3 premiers mots ou avant le premier délimiteur)
    if (candidatesMap.size === 0 && query.includes(" ")) {
        const words = query.split(" ").filter(Boolean);
        if (words.length >= 2) {
            const shortQuery = words.slice(0, Math.min(3, words.length - 1)).join(" ");
            if (shortQuery && shortQuery.length >= 3) {
                try {
                    const shortRes = await callWithRetry(() =>
                        tmdbClient.search.multi({ query: shortQuery, language, page: 1 })
                    ).catch(() => null);
                    addCandidates(shortRes?.results);
                } catch (e) {}
            }
        }
    }

    return Array.from(candidatesMap.values()).slice(0, 15);
}

// =============================================================================
// FONCTION PRINCIPALE EXPORTÉE : resolveTmdbMatch
// =============================================================================

/**
 * @typedef {Object} ResolvedTmdbMatch
 * @property {Object|null} match - Meilleur candidat sélectionné (ou null si score insuffisant)
 * @property {number} score - Score de confiance du meilleur candidat (0.0 à 1.0)
 * @property {Array<{ candidate: Object, score: number }>} candidates - Liste des N meilleurs candidats triés
 * @property {string} parsedTitle - Titre extrait et normalisé
 * @property {number|null} detectedYear - Année détectée
 * @property {'tv'|'movie'|null} mediaType - Type de média résolu
 */

/**
 * Résout un nom de fichier brut ou un titre de release vers la correspondance TMDB optimale.
 *
 * @param {string} rawTitle - Titre ou nom de release brut
 * @param {Object} [options={}]
 * @param {string} [options.language='fr-FR'] - Langue des métadonnées (défaut: 'fr-FR')
 * @param {'tv'|'movie'|null} [options.preferredType=null] - Type préféré si connu d'avance
 * @param {number|string|null} [options.year=null] - Année indicative
 * @param {string|null} [options.tmdbKey=null] - Clé d'API TMDB
 * @param {Object} [options.tmdbClient=null] - Client TMDB injecté (utile pour les tests/mocks)
 * @param {boolean} [options.skipCache=false] - Ignore le cache (utile pour tests)
 * @returns {Promise<ResolvedTmdbMatch>}
 */
async function resolveTmdbMatch(rawTitle, options = {}) {
    const emptyResult = {
        match: null,
        score: 0,
        candidates: [],
        parsedTitle: "",
        detectedYear: null,
        mediaType: null
    };

    if (!rawTitle || typeof rawTitle !== "string" || rawTitle.trim().length === 0) {
        return emptyResult;
    }

    const cleanInput = rawTitle.trim();
    const language = options.language || "fr-FR";
    const effectiveTmdbKey =
        options.tmdbKey && options.tmdbKey !== "default"
            ? options.tmdbKey
            : process.env.TMDB_API_KEY || TMDB_KEY_DEFAULT;

    // Hash sécurisé pour les caches L1 mémoire et L2 SQLite
    const cacheKey = crypto
        .createHash("sha256")
        .update(`${language}:${options.preferredType || ""}:${cleanInput.toLowerCase()}`)
        .digest("hex");

    // 1. Vérification Cache Mémoire L1
    if (!options.skipCache && resolutionMemoryLRU.has(cacheKey)) {
        return resolutionMemoryLRU.get(cacheKey);
    }

    // 2. Vérification Cache SQLite L2 (30 jours)
    if (!options.skipCache) {
        const sqliteCached = getTmdbResolution(cacheKey, 30 * 86400);
        if (sqliteCached && sqliteCached.tmdbId) {
            const cachedResult = {
                match: {
                    id: sqliteCached.tmdbId,
                    media_type: sqliteCached.mediaType,
                    title: sqliteCached.details?.title || cleanInput,
                    name: sqliteCached.details?.name || cleanInput,
                    release_date: sqliteCached.details?.release_date || null,
                    first_air_date: sqliteCached.details?.first_air_date || null,
                    poster_path: sqliteCached.details?.poster_path || null,
                    backdrop_path: sqliteCached.details?.backdrop_path || null,
                    overview: sqliteCached.details?.overview || ""
                },
                score: sqliteCached.score,
                candidates: [],
                parsedTitle: sqliteCached.details?.parsedTitle || cleanInput,
                detectedYear: sqliteCached.details?.detectedYear || null,
                mediaType: sqliteCached.mediaType
            };
            resolutionMemoryLRU.set(cacheKey, cachedResult);
            return cachedResult;
        }
    }

    // 3. Extraction et parsing du titre
    const meta = extractQueryAndMetadata(cleanInput, options);
    if (!meta.primaryQuery) {
        return emptyResult;
    }

    // 4. Initialisation du client TMDB (injecté pour mock ou créé via tmdb-kit)
    let tmdbClient = options.tmdbClient || null;
    if (!tmdbClient) {
        if (!effectiveTmdbKey) {
            return {
                ...emptyResult,
                parsedTitle: meta.primaryQuery,
                detectedYear: meta.detectedYear,
                mediaType: meta.preferredType
            };
        }
        try {
            tmdbClient = createTMDB({ apiKey: effectiveTmdbKey });
        } catch (e) {
            return emptyResult;
        }
    }

    try {
        // 5. Recherche multi-passes
        const allQueries = [meta.primaryQuery, ...meta.altQueries];
        let rawCandidates = [];

        for (const q of allQueries) {
            const passResults = await searchMultiPass(tmdbClient, q, meta, language);
            if (passResults && passResults.length > 0) {
                rawCandidates = passResults;
                break;
            }
        }

        if (rawCandidates.length === 0) {
            const noMatchRes = {
                match: null,
                score: 0,
                candidates: [],
                parsedTitle: meta.primaryQuery,
                detectedYear: meta.detectedYear,
                mediaType: meta.preferredType
            };
            return noMatchRes;
        }

        // 6. Récupération des titres alternatifs et scoring des candidats
        const scoredCandidates = [];

        for (const cand of rawCandidates) {
            const candMediaType = cand.media_type === "tv" ? "tv" : "movie";
            let altTitles = [];
            try {
                altTitles = await fetchTmdbAlternativeTitles(tmdbClient, candMediaType, cand.id);
            } catch (e) {}

            const score = scoreCandidate(cand, allQueries, meta, altTitles);
            scoredCandidates.push({ candidate: cand, score });
        }

        // Tri par score décroissant
        scoredCandidates.sort((a, b) => b.score - a.score);

        const topCands = scoredCandidates.slice(0, MAX_CANDIDATES_RETURNED);
        const best = topCands[0] || null;
        const isMatch = best && best.score >= CONFIDENCE_THRESHOLD;

        const result = {
            match: isMatch ? best.candidate : null,
            score: best ? best.score : 0,
            candidates: topCands,
            parsedTitle: meta.primaryQuery,
            detectedYear: meta.detectedYear,
            mediaType: isMatch ? best.candidate.media_type : meta.preferredType
        };

        // 7. Enregistrement dans les caches mémoire et SQLite si match probant
        if (isMatch && best.candidate && best.candidate.id) {
            resolutionMemoryLRU.set(cacheKey, result);
            const cand = best.candidate;
            const details = {
                title: cand.title || cand.name || "",
                name: cand.name || cand.title || "",
                release_date: cand.release_date || null,
                first_air_date: cand.first_air_date || null,
                poster_path: cand.poster_path || null,
                backdrop_path: cand.backdrop_path || null,
                overview: cand.overview || "",
                parsedTitle: meta.primaryQuery,
                detectedYear: meta.detectedYear
            };
            saveTmdbResolution(cacheKey, cleanInput, cand.id, cand.media_type || "movie", best.score, details);
        }

        // 8. Observabilité debug
        if (process.env.DEBUG_TMDB === "true" || process.env.DEBUG_TMDB_RESOLVER === "true") {
            const matchName = isMatch ? best.candidate.title || best.candidate.name : "AUCUN MATCH (ambiguïté)";
            const matchId = isMatch ? best.candidate.id : "null";
            const matchScore = best ? best.score.toFixed(3) : "0.000";
            console.log(
                `[TitleResolver] "${cleanInput}" -> "${meta.primaryQuery}" => Retenu: "${matchName}" (id:${matchId}) [Score: ${matchScore}]`
            );
        }

        return result;
    } catch (err) {
        // En cas d'erreur réseau TMDB imprévue, ne jamais throw
        return {
            match: null,
            score: 0,
            candidates: [],
            parsedTitle: meta.primaryQuery,
            detectedYear: meta.detectedYear,
            mediaType: meta.preferredType
        };
    }
}

module.exports = {
    resolveTmdbMatch,
    extractQueryAndMetadata,
    normalizeRomanNumerals,
    normalizeForComparison,
    scoreCandidate,
    CONFIDENCE_THRESHOLD,
    MAX_CANDIDATES_RETURNED
};
