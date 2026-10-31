import animeMappingModule from "../../../lib/animeMapping.js";

export function loadAnimeMapping(): void {
    animeMappingModule.loadAnimeMapping();
}

export function getAnimeIdsByImdb(imdbId: string): unknown {
    return animeMappingModule.getAnimeIdsByImdb(imdbId);
}

export function getAnimeIdsByKitsu(kitsuId: string | number): unknown {
    return animeMappingModule.getAnimeIdsByKitsu(kitsuId);
}

export function getAnimeIdsByAnidb(anidbId: string | number): unknown {
    return animeMappingModule.getAnimeIdsByAnidb(anidbId);
}
