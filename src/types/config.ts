export interface UserConfig {
    uuid?: string;
    pseudo?: string;
    apikey?: string; // AllDebrid API Key
    torbox_apikey?: string; // Torbox API Key
    rd_apikey?: string; // Real-Debrid API Key
    debridlink_apikey?: string; // Debrid-Link API Key

    // Indexers
    prowlarr_url?: string;
    prowlarr_key?: string;
    prowlarrMode?: "shared" | "private";
    jackett_url?: string;
    jackett_key?: string;
    // TMDB & Metadata
    tmdb_api_key?: string;

    // Options
    resolutions?: string[];
    max_streams?: number;
    sort_by?: "resolution" | "seeders" | "size";
    preferred_lang?: string;
    excluded_keywords?: string[];
    show_cloud_catalogs?: boolean;
    enable_anime_mapping?: boolean;

    [key: string]: unknown;
}

export interface SystemSettings {
    httpTimeoutMs?: number;
    prowlarrTimeoutMs?: number;
    cacheTtlDays?: number;
    embedHtml?: string;
    embedIframeUrl?: string;
    embedIframeHeight?: number;
    discordUrl?: string;
    torrentioEgress?: "auto" | "direct";
    customTitle?: string;
}

export interface UserEntity {
    id?: number;
    uuid: string;
    pseudo: string;
    config_encrypted: string;
    created_at?: string;
    last_active?: string;
}
