import titleResolverModule from "../../../lib/titleResolver.js";

export async function resolveTitleToTmdb(
    rawTitle: string,
    options: {
        expectedType?: "movie" | "series" | "anime";
        expectedYear?: number;
        customTmdbKey?: string;
    } = {}
) {
    return titleResolverModule.resolveTitleToTmdb(rawTitle, options);
}

export function computeTitleMatchScore(candidateTitle: string, targetTitle: string): number {
    return titleResolverModule.computeTitleMatchScore(candidateTitle, targetTitle);
}
