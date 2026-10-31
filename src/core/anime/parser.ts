import animeParserModule from "../../../lib/animeParser.js";

export interface ParsedAnime {
    success: boolean;
    raw: string;
    title: string;
    baseTitle: string;
    releaseGroup: string | null;
    season: number;
    episode: number | null;
    episodeEnd: number | null;
    episodeRaw: string | null;
    resolution: string | null;
    videoTerm: string | null;
    audioTerm: string | null;
    fileExtension: string | null;
    isBatch: boolean;
    isMovie: boolean;
    parser: "anitomy" | "fallback";
}

export function parseAnimeFilename(filename: string): ParsedAnime {
    return animeParserModule.parseAnimeFilename(filename);
}

export function isConfidentAnimeMatch(
    releaseTitle: string,
    queryTitle: string,
    season?: number,
    episode?: number
): boolean {
    return animeParserModule.isConfidentAnimeMatch(releaseTitle, queryTitle, season, episode);
}
