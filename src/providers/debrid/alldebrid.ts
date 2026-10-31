import axios, { AxiosInstance } from "axios";
import { BaseDebridProvider, createProxyAgent } from "./base.js";
import {
    DebridKeyCheckResult,
    DebridProviderName,
    ResolveStreamParams,
    ResolveStreamResult
} from "../../types/debrid.js";
import { UserConfig } from "../../types/config.js";
import { BROWSER_UA } from "../../config/constants.js";
import { makeLRU } from "../../core/cache.js";

const PROXY_URL = process.env.WARP_PROXY || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
const instantCacheLRU = makeLRU<string, boolean>(1000, 3600_000);

export function isAllDebridMagnetReady(magnet: unknown): boolean {
    if (!magnet || typeof magnet !== "object") return false;
    const m = magnet as Record<string, unknown>;
    if (m.ready === true) return true;
    const code = Number(m.statusCode);
    if (!Number.isFinite(code)) return true;
    return code === 4;
}

export class AllDebridProvider extends BaseDebridProvider {
    readonly name: DebridProviderName = "alldebrid";
    readonly displayName = "AllDebrid";

    private api: AxiosInstance;
    private warpAgent = PROXY_URL ? createProxyAgent(PROXY_URL) : null;
    private warpActive = Boolean(this.warpAgent);

    constructor() {
        super();
        this.api = axios.create({
            baseURL: "https://api.alldebrid.com",
            timeout: 10000,
            headers: {
                "User-Agent": BROWSER_UA,
                Accept: "application/json"
            },
            httpAgent: this.warpActive ? this.warpAgent : undefined,
            httpsAgent: this.warpActive ? this.warpAgent : undefined,
            proxy: false
        });
    }

    isConfigured(config: UserConfig): boolean {
        return Boolean(config.apikey || config.apiKey || process.env.ALLDEBRID_API_KEY);
    }

    getApiKey(config: UserConfig): string | undefined {
        return (config.apikey as string) || (config.apiKey as string) || process.env.ALLDEBRID_API_KEY;
    }

    private adHeaders(apiKey: string): Record<string, string> {
        return {
            Authorization: `Bearer ${apiKey.trim()}`,
            "User-Agent": BROWSER_UA,
            Accept: "application/json"
        };
    }

    async get(endpoint: string, apiKey: string, params: Record<string, unknown> = {}): Promise<unknown> {
        const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
        return this.api.get(cleanEndpoint, {
            headers: this.adHeaders(apiKey),
            params
        });
    }

    async post(endpoint: string, apiKey: string, data: Record<string, unknown> = {}): Promise<unknown> {
        const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
        const formData = new URLSearchParams();
        for (const [k, v] of Object.entries(data)) {
            formData.append(k, String(v));
        }
        return this.api.post(cleanEndpoint, formData.toString(), {
            headers: {
                ...this.adHeaders(apiKey),
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });
    }

    async checkKey(apiKey: string): Promise<DebridKeyCheckResult> {
        if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
            return { success: false, valid: false, error: "Clé AllDebrid requise." };
        }
        try {
            const res = (await this.get("/v4/user", apiKey)) as {
                data: { status: string; data?: { user?: { username?: string; isPremium?: boolean } } };
            };
            if (res.data && res.data.status === "success" && res.data.data?.user) {
                return {
                    success: true,
                    valid: true,
                    username: res.data.data.user.username,
                    isPremium: res.data.data.user.isPremium
                };
            }
            return { success: false, valid: false, error: "Clé AllDebrid invalide." };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, valid: false, error: msg };
        }
    }

    async checkInstantAvailability(hashes: string[], apiKey: string): Promise<Record<string, boolean>> {
        if (!hashes || !Array.isArray(hashes) || hashes.length === 0 || !apiKey) {
            return {};
        }

        const uniqueHashes = [...new Set(hashes.map(h => (h || "").trim().toLowerCase()).filter(Boolean))];
        if (uniqueHashes.length === 0) return {};

        const results: Record<string, boolean> = {};
        const missingHashes: string[] = [];

        for (const h of uniqueHashes) {
            const cached = instantCacheLRU.get(h);
            if (cached !== undefined) {
                results[h] = cached;
            } else {
                missingHashes.push(h);
            }
        }

        if (missingHashes.length === 0) return results;

        const BATCH_SIZE = 50;
        for (let i = 0; i < missingHashes.length; i += BATCH_SIZE) {
            const batch = missingHashes.slice(i, i + BATCH_SIZE);
            try {
                const res = (await this.post("/v4/magnet/instant", apiKey, {
                    "magnets[]": batch
                })) as { data: { status: string; data?: { response?: Array<{ magnet: string; instant?: boolean }> } } };

                if (res.data?.status === "success" && Array.isArray(res.data.data?.response)) {
                    for (const item of res.data.data.response) {
                        const h = item.magnet.toLowerCase();
                        const isInstant = Boolean(item.instant);
                        results[h] = isInstant;
                        instantCacheLRU.set(h, isInstant);
                    }
                }
            } catch {
                for (const h of batch) {
                    if (results[h] === undefined) results[h] = false;
                }
            }
        }

        return results;
    }

    async resolveStream(params: ResolveStreamParams): Promise<ResolveStreamResult> {
        const { apiKey, fileRef } = params;
        if (!fileRef || !apiKey) {
            throw new Error("Paramètres AllDebrid manquants pour la résolution.");
        }

        // Cas lien direct débridable
        if (/^https?:\/\//i.test(fileRef)) {
            const res = (await this.post("/v4/link/unlock", apiKey, { link: fileRef })) as {
                data: { status: string; data?: { link?: string; filename?: string } };
            };
            if (res.data?.status === "success" && res.data.data?.link) {
                return {
                    url: res.data.data.link,
                    filename: res.data.data.filename,
                    streamable: true
                };
            }
            throw new Error("Échec du débridage de lien AllDebrid.");
        }

        // Cas magnet
        let magnetUri = fileRef;
        if (/^[a-f0-9]{40}$/i.test(fileRef)) {
            magnetUri = `magnet:?xt=urn:btih:${fileRef}`;
        }

        const uploadRes = (await this.post("/v4/magnet/upload", apiKey, {
            "magnets[]": [magnetUri]
        })) as {
            data: { status: string; data?: { magnets?: Array<{ id: number; ready: boolean }> } };
        };

        const magnetObj = uploadRes.data?.data?.magnets?.[0];
        if (!magnetObj?.id) {
            throw new Error("Impossible d'uploader le magnet sur AllDebrid.");
        }

        const statusRes = (await this.get(`/v4/magnet/status?id=${magnetObj.id}`, apiKey)) as {
            data: {
                status: string;
                data?: {
                    magnets?: {
                        links?: Array<{ link: string; filename: string }>;
                    };
                };
            };
        };

        const linkItem = statusRes.data?.data?.magnets?.links?.[0];
        if (!linkItem?.link) {
            throw new Error("Magnet AllDebrid non prêt pour streaming immédiat.");
        }

        const unres = (await this.post("/v4/link/unlock", apiKey, { link: linkItem.link })) as {
            data: { status: string; data?: { link?: string; filename?: string } };
        };

        if (unres.data?.status === "success" && unres.data.data?.link) {
            return {
                url: unres.data.data.link,
                filename: unres.data.data.filename || linkItem.filename,
                streamable: true
            };
        }

        throw new Error("Échec du débridage du flux AllDebrid.");
    }
}

export const allDebridProvider = new AllDebridProvider();
