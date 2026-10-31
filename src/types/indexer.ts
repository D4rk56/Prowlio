export interface SearchTorrentResult {
    title: string;
    infoHash: string;
    magnetUrl?: string;
    downloadUrl?: string;
    size: number;
    seeders: number;
    leechers?: number;
    indexer: string;
    source: "prowlarr" | "jackett" | "cache" | string;
    publishDate?: string;
}

export interface TorznabQuery {
    imdbId?: string;
    title?: string;
    year?: number | string;
    season?: number;
    episode?: number;
    type: "movie" | "series" | "anime" | string;
}

export interface ProwlarrInstance {
    id?: number;
    name: string;
    url: string;
    apiKey: string;
    isShared: boolean;
    failCount?: number;
    disabledUntil?: number;
}
