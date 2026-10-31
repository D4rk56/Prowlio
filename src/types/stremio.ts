export interface ManifestCatalog {
    type: string;
    id: string;
    name: string;
    extra?: Array<{
        name: string;
        isRequired?: boolean;
        options?: string[];
        optionsLimit?: number;
    }>;
}

export interface StremioManifest {
    id: string;
    version: string;
    name: string;
    description: string;
    resources: Array<string | { name: string; types: string[]; idPrefixes?: string[] }>;
    types: string[];
    catalogs: ManifestCatalog[];
    idPrefixes?: string[];
    behaviorHints?: {
        adult?: boolean;
        p2p?: boolean;
        configurable?: boolean;
        configurationRequired?: boolean;
    };
    logo?: string;
    background?: string;
}

export interface StreamBehaviorHints {
    notWebReady?: boolean;
    bingeGroup?: string;
    proxyHeaders?: Record<string, string>;
    videoHash?: string;
    filename?: string;
}

export interface StremioStream {
    name: string;
    title: string;
    url?: string;
    externalUrl?: string;
    infoHash?: string;
    fileIdx?: number;
    behaviorHints?: StreamBehaviorHints;
    _source?: string;
    _indexer?: string;
    _resolution?: string;
    _size?: number;
}

export interface StremioMetaVideo {
    id: string;
    title: string;
    released: string;
    thumbnail?: string;
    episode?: number;
    season?: number;
    overview?: string;
}

export interface StremioMetaDetail {
    id: string;
    type: "movie" | "series" | "anime" | "other" | string;
    name: string;
    poster?: string;
    background?: string;
    logo?: string;
    description?: string;
    releaseInfo?: string;
    year?: string | number;
    imdbRating?: string | number;
    genres?: string[];
    videos?: StremioMetaVideo[];
}

export interface CatalogResponse {
    metas: StremioMetaDetail[];
}

export interface StreamResponse {
    streams: StremioStream[];
}
