import { UserConfig } from "./config.js";

export type DebridProviderName = "alldebrid" | "realdebrid" | "torbox" | "debridlink";

export interface DebridKeyCheckResult {
    success: boolean;
    valid: boolean;
    isPremium?: boolean;
    username?: string;
    expiration?: string;
    error?: string;
}

export interface DebridFile {
    id: string | number;
    name: string;
    size: number;
    link?: string;
    downloadUrl?: string;
}

export interface DebridTorrentInfo {
    id: string | number;
    hash?: string;
    filename?: string;
    size?: number;
    status?: string;
    statusCode?: number;
    ready: boolean;
    progress?: number;
    downloaded?: number;
    files?: DebridFile[];
    links?: string[];
}

export interface ResolveStreamParams {
    apiKey: string;
    fileRef: string;
    imdbId?: string;
    userConfig?: UserConfig;
}

export interface ResolveStreamResult {
    url: string;
    filename?: string;
    streamable?: boolean;
}

export interface IDebridProvider {
    readonly name: DebridProviderName;
    readonly displayName: string;

    isConfigured(config: UserConfig): boolean;
    getApiKey(config: UserConfig): string | undefined;
    checkKey(apiKey: string): Promise<DebridKeyCheckResult>;
    checkInstantAvailability(hashes: string[], apiKey: string): Promise<Record<string, boolean>>;
    resolveStream(params: ResolveStreamParams): Promise<ResolveStreamResult>;
}
