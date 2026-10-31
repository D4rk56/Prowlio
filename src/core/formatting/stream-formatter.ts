import helpersModule from "../../../lib/helpers.js";
import { StremioStream } from "../../types/stremio.js";
import { UserConfig } from "../../types/config.js";

export function formatAioStream(
    stream: StremioStream,
    providerBadge: string,
    indexer: string,
    cached: boolean
): StremioStream {
    return helpersModule.formatAioStream(stream, providerBadge, indexer, cached);
}

export function filterAndSortStreams(streams: StremioStream[], config: UserConfig): StremioStream[] {
    return helpersModule.filterAndSortStreams(streams, config);
}

export function parseSeasonEpisode(name: string): { season: number | null; episode: number | null } {
    return helpersModule.parseSeasonEpisode(name);
}

export function extractCleanTitle(title: string): string {
    return helpersModule.extractCleanTitle(title);
}

export function parseSizeFromString(sizeStr: string): number {
    return helpersModule.parseSizeFromString(sizeStr);
}

export function isRealVideoFile(filename: string): boolean {
    return helpersModule.isRealVideoFile(filename);
}

export function extractTechBadge(title: string): string {
    return helpersModule.extractTechBadge(title);
}

export function sortByLangPref(streams: StremioStream[], langPref?: string): StremioStream[] {
    return helpersModule.sortByLangPref(streams, langPref);
}
