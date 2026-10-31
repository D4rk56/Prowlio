import jackettModule from "../../../lib/jackett.js";
import { SearchTorrentResult, TorznabQuery } from "../../types/indexer.js";

export async function checkJackettConnectivity(
    url: string,
    key: string
): Promise<{
    success: boolean;
    valid: boolean;
    appName?: string;
    version?: string;
    status?: number;
    error?: string;
}> {
    return jackettModule.checkJackettConnectivity(url, key);
}

export async function searchJackett(
    query: TorznabQuery,
    url: string,
    key: string,
    timeoutMs = 10000
): Promise<SearchTorrentResult[]> {
    return jackettModule.searchJackett(query, url, key, timeoutMs);
}
