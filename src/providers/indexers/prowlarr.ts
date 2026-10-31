import prowlarrModule from "../../../lib/prowlarr-worker.js";
import { SearchTorrentResult } from "../../types/indexer.js";

export async function searchProwlarrOnDemand(
    queryTitle: string,
    imdbId: string,
    season = null,
    episode = null,
    userInstances = [],
    sharedInstances = []
): Promise<SearchTorrentResult[]> {
    return prowlarrModule.searchProwlarrOnDemand(queryTitle, imdbId, season, episode, userInstances, sharedInstances);
}

export function isLocalOrPrivateUrl(urlStr: string): boolean {
    return prowlarrModule.isLocalOrPrivateUrl(urlStr);
}
