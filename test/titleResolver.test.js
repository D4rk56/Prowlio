"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    resolveTmdbMatch,
    extractQueryAndMetadata,
    normalizeRomanNumerals,
    normalizeForComparison,
    scoreCandidate,
    CONFIDENCE_THRESHOLD
} = require("../lib/titleResolver");

test("TitleResolver - Normalisation des chiffres romains et comparaisons", () => {
    assert.equal(normalizeRomanNumerals("Gladiator II"), "Gladiator 2");
    assert.equal(normalizeRomanNumerals("Rocky IV"), "Rocky 4");
    assert.equal(normalizeRomanNumerals("Fast & Furious X"), "Fast & Furious 10");
    assert.equal(normalizeRomanNumerals("Mob Psycho 100 III"), "Mob Psycho 100 3");

    // Préservation des mots normaux
    assert.equal(normalizeRomanNumerals("Six"), "Six");
    assert.equal(normalizeRomanNumerals("Vivarium"), "Vivarium");

    // Normalisation complète pour comparaison floue
    assert.equal(normalizeForComparison("Dune: Part Two"), "dune part 2");
    assert.equal(normalizeForComparison("Gladiator II"), "gladiator 2");
    assert.equal(normalizeForComparison("Sousou no Frieren"), "sousou no frieren");
});

test("TitleResolver - Extraction de requêtes et métadonnées", () => {
    // 1. Anime fansub complexe
    const a1 = extractQueryAndMetadata("[Sakurato] RWBY Hyousetsu Teikoku [05][HEVC-10bit 1080p AAC][CHS&CHT].mp4");
    assert.equal(a1.primaryQuery, "RWBY Hyousetsu Teikoku");
    assert.equal(a1.isAnime, true);
    assert.equal(a1.preferredType, "tv");

    // 2. Film avec balises warez et année
    const m1 = extractQueryAndMetadata("Dune.Part.Two.2024.MULTi.2160p.UHD.HDR.DV.TrueHD.Atmos.7.1-EXTREME.mkv");
    assert.equal(m1.primaryQuery, "Dune Part Two");
    assert.equal(m1.detectedYear, 2024);
    assert.equal(m1.preferredType, "movie");

    // 3. Série avec SxxExx et titre d'épisode
    const s1 = extractQueryAndMetadata(
        "Severance.S02E01.Hello.Ms.Cobel.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv"
    );
    assert.equal(s1.primaryQuery, "Severance");
    assert.equal(s1.preferredType, "tv");

    // 4. Titre avec ponctuation problématique pour TMDB
    const p1 = extractQueryAndMetadata("Steins;Gate: The Movie - Load Region of Déjà Vu");
    assert.ok(!p1.primaryQuery.includes(":"));
});

test("TitleResolver - Scoring : 'Naruto' ne doit PAS matcher 'Naruto Shippuden'", () => {
    const queryTitles = ["Naruto"];
    const meta = { preferredType: "tv", detectedYear: 2002 };

    const candNaruto = {
        id: 46260,
        name: "Naruto",
        original_name: "NARUTO -ナルト-",
        media_type: "tv",
        first_air_date: "2002-10-03"
    };

    const candShippuden = {
        id: 31910,
        name: "Naruto Shippuden",
        original_name: "NARUTO -ナルト- 疾風伝",
        media_type: "tv",
        first_air_date: "2007-02-15"
    };

    const scoreNaruto = scoreCandidate(candNaruto, queryTitles, meta, ["Naruto"]);
    const scoreShippuden = scoreCandidate(candShippuden, queryTitles, meta, ["Naruto Shippuuden"]);

    assert.ok(
        scoreNaruto >= CONFIDENCE_THRESHOLD,
        `Le score de Naruto doit être >= ${CONFIDENCE_THRESHOLD} (obtenu: ${scoreNaruto})`
    );
    assert.ok(
        scoreShippuden < 0.7,
        `Le score de Shippuden doit subir la pénalité de suite (obtenu: ${scoreShippuden})`
    );
    assert.ok(scoreNaruto > scoreShippuden + 0.25, "Naruto doit nettement dépasser Shippuden");
});

test("TitleResolver - Scoring : 'Attack on Titan Final Season' matche la bonne entrée", () => {
    const queryTitles = ["Attack on Titan Final Season", "Shingeki no Kyojin The Final Season"];
    const meta = { preferredType: "tv", detectedYear: 2020 };

    const candFinalSeason = {
        id: 1429,
        name: "L'Attaque des Titans",
        original_name: "進撃の巨人",
        media_type: "tv",
        first_air_date: "2013-04-07"
    };

    const aliases = ["Attack on Titan", "Shingeki no Kyojin", "Attack on Titan: The Final Season"];
    const score = scoreCandidate(candFinalSeason, queryTitles, meta, aliases);

    assert.ok(score >= CONFIDENCE_THRESHOLD, `Score attendu élevé via les alias (obtenu: ${score})`);
});

test("TitleResolver - Scoring : 'Sousou no Frieren' matche via alternative_titles (anglais/romaji)", () => {
    const queryTitles = ["Sousou no Frieren"];
    const meta = { preferredType: "tv", detectedYear: 2023 };

    // Sur TMDB, le titre en français ou anglais peut être "Frieren: Beyond Journey's End"
    const candFrieren = {
        id: 209867,
        name: "Frieren",
        original_name: "葬送のフリーレン",
        media_type: "tv",
        first_air_date: "2023-09-29"
    };

    const aliases = ["Frieren: Beyond Journey's End", "Sousou no Frieren", "Frieren au par-delà de la fin du voyage"];

    const score = scoreCandidate(candFrieren, queryTitles, meta, aliases);
    assert.ok(score >= CONFIDENCE_THRESHOLD, `Frieren doit matcher via alternative_titles (obtenu: ${score})`);
});

test("TitleResolver - Scoring : 'Dune' vs 'Dune: Part Two' et 'Gladiator II' vs 'Gladiator'", () => {
    // 1. Film avec suite (Dune 1 vs Dune 2)
    const qDune2 = ["Dune Part Two"];
    const metaDune = { preferredType: "movie", detectedYear: 2024 };

    const candDune1 = {
        id: 438631,
        title: "Dune",
        original_title: "Dune",
        media_type: "movie",
        release_date: "2021-09-15"
    };

    const candDune2 = {
        id: 693134,
        title: "Dune : Deuxième Partie",
        original_title: "Dune: Part Two",
        media_type: "movie",
        release_date: "2024-02-27"
    };

    const scoreD1 = scoreCandidate(candDune1, qDune2, metaDune, ["Dune (2021)"]);
    const scoreD2 = scoreCandidate(candDune2, qDune2, metaDune, ["Dune 2", "Dune: Part Two"]);

    assert.ok(scoreD2 >= CONFIDENCE_THRESHOLD, `Dune 2 doit être sélectionné (obtenu: ${scoreD2})`);
    assert.ok(scoreD1 < 0.65, `Dune 1 ne doit pas matcher Dune Part Two (obtenu: ${scoreD1})`);

    // 2. Chiffres romains : Gladiator II
    const qGlad2 = ["Gladiator II"];
    const metaGlad = { preferredType: "movie", detectedYear: 2024 };

    const candGlad1 = {
        id: 98,
        title: "Gladiator",
        original_title: "Gladiator",
        media_type: "movie",
        release_date: "2000-05-01"
    };

    const candGlad2 = {
        id: 558449,
        title: "Gladiator II",
        original_title: "Gladiator II",
        media_type: "movie",
        release_date: "2024-11-13"
    };

    const scoreGlad1 = scoreCandidate(candGlad1, qGlad2, metaGlad, ["Gladiator"]);
    const scoreGlad2 = scoreCandidate(candGlad2, qGlad2, metaGlad, ["Gladiator 2"]);

    assert.ok(scoreGlad2 >= CONFIDENCE_THRESHOLD, `Gladiator II doit matcher (obtenu: ${scoreGlad2})`);
    assert.ok(scoreGlad1 < 0.65, `Gladiator 1 ne doit pas matcher Gladiator II (obtenu: ${scoreGlad1})`);
});

test("TitleResolver - Scoring : Coffrets / Packs rejetés pour un film individuel", () => {
    const qToy = ["Toy Story"];
    const meta = { preferredType: "movie", detectedYear: 1995 };

    const candCollection = {
        id: 10193,
        title: "Toy Story Quadrilogie",
        original_title: "Toy Story Collection",
        media_type: "movie",
        release_date: "2019-06-19"
    };

    const score = scoreCandidate(candCollection, qToy, meta, ["Toy Story Quad"]);
    assert.ok(score < 0.6, `La collection doit subir la pénalité PACK_PENALTY (obtenu: ${score})`);
});

test("TitleResolver - resolveTmdbMatch avec client mocké : flux complet", async () => {
    // Mock du client TMDB retournant des données simulées
    const mockTmdbClient = {
        search: {
            multi: async ({ query }) => {
                if (query.toLowerCase().includes("rwby")) {
                    return {
                        results: [
                            {
                                id: 197085,
                                name: "RWBY: Ice Queendom",
                                original_name: "RWBY 氷雪帝国",
                                media_type: "tv",
                                first_air_date: "2022-07-03",
                                poster_path: "/rwby.jpg",
                                overview: "Dans un monde fantastique..."
                            }
                        ]
                    };
                }
                if (query.toLowerCase().includes("severance")) {
                    return {
                        results: [
                            {
                                id: 95396,
                                name: "Severance",
                                original_name: "Severance",
                                media_type: "tv",
                                first_air_date: "2022-02-18",
                                poster_path: "/severance.jpg"
                            }
                        ]
                    };
                }
                return { results: [] };
            },
            movies: async () => ({ results: [] }),
            tv: async () => ({ results: [] })
        },
        request: async path => {
            if (path.includes("197085")) {
                return {
                    results: [{ title: "RWBY Hyousetsu Teikoku" }, { title: "RWBY: Ice Queendom" }]
                };
            }
            return { results: [] };
        }
    };

    // Test 1 : Anime fansub complexe avec nom japonais
    const animeRes = await resolveTmdbMatch(
        "[Sakurato] RWBY Hyousetsu Teikoku [05][HEVC-10bit 1080p AAC][CHS&CHT].mp4",
        { tmdbClient: mockTmdbClient, skipCache: true }
    );
    assert.ok(animeRes.match !== null, "RWBY doit être résolu avec succès");
    assert.equal(animeRes.match.id, 197085);
    assert.ok(animeRes.score >= CONFIDENCE_THRESHOLD);

    // Test 2 : Série occidentale complexe
    const seriesRes = await resolveTmdbMatch(
        "Severance.S02E01.Hello.Ms.Cobel.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv",
        { tmdbClient: mockTmdbClient, skipCache: true }
    );
    assert.ok(seriesRes.match !== null, "Severance doit être résolu avec succès");
    assert.equal(seriesRes.match.id, 95396);
    assert.equal(seriesRes.mediaType, "tv");

    // Test 3 : Titre introuvable -> retourne null proprement sans throw
    const unknownRes = await resolveTmdbMatch("TitreCompletementInexistantEtIntrouvable98765.mkv", {
        tmdbClient: mockTmdbClient,
        skipCache: true
    });
    assert.equal(unknownRes.match, null);
    assert.equal(unknownRes.candidates.length, 0);

    // Test 4 : Titre vide ou invalide -> retourne résultat vide sans throw
    const emptyRes = await resolveTmdbMatch("", { tmdbClient: mockTmdbClient, skipCache: true });
    assert.equal(emptyRes.match, null);
    assert.equal(emptyRes.score, 0);
});

test("TitleResolver - Séries : Désambiguïsation des reboots par l'année (Doctor Who)", () => {
    const qDoc2005 = ["Doctor Who"];
    const meta2005 = { preferredType: "tv", detectedYear: 2005 };

    const cand1963 = {
        id: 121,
        name: "Doctor Who",
        original_name: "Doctor Who",
        media_type: "tv",
        first_air_date: "1963-11-23"
    };

    const cand2005 = {
        id: 57243,
        name: "Doctor Who",
        original_name: "Doctor Who",
        media_type: "tv",
        first_air_date: "2005-03-26"
    };

    const cand2023 = {
        id: 239770,
        name: "Doctor Who",
        original_name: "Doctor Who",
        media_type: "tv",
        first_air_date: "2023-11-25"
    };

    const score1963 = scoreCandidate(cand1963, qDoc2005, meta2005);
    const score2005 = scoreCandidate(cand2005, qDoc2005, meta2005);
    const score2023 = scoreCandidate(cand2023, qDoc2005, meta2005);

    assert.ok(
        score2005 >= CONFIDENCE_THRESHOLD,
        `La version 2005 doit obtenir un score >= 0.85 (obtenu: ${score2005})`
    );
    assert.ok(score2005 > score1963, "L'année 2005 doit battre l'année 1963");
    assert.ok(score2005 > score2023, "L'année 2005 doit battre l'année 2023");
});

test("TitleResolver - Ponctuation : Titres avec deux-points ou points-virgules (Steins;Gate, Re:Zero)", () => {
    const qSteins = extractQueryAndMetadata("Steins;Gate - 01 (1080p).mkv");
    assert.ok(!qSteins.primaryQuery.includes(";"));
    assert.ok(qSteins.primaryQuery.toLowerCase().includes("steins gate"));

    const qReZero = extractQueryAndMetadata(
        "[Erai-raws] Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season - 14 [1080p].mkv"
    );
    assert.ok(!qReZero.primaryQuery.includes(":"));
    assert.ok(
        qReZero.primaryQuery.toLowerCase().includes("rezero") || qReZero.primaryQuery.toLowerCase().includes("re zero")
    );
});
