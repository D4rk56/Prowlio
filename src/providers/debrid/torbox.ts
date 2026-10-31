import axios from "axios";
import { BaseDebridProvider } from "./base.js";
import {
    DebridKeyCheckResult,
    DebridProviderName,
    ResolveStreamParams,
    ResolveStreamResult
} from "../../types/debrid.js";
import { UserConfig } from "../../types/config.js";
import { BROWSER_UA } from "../../config/constants.js";

const TORBOX_API_BASE = "https://api.torbox.app/v1/api";

const torboxApi = axios.create({
    baseURL: TORBOX_API_BASE,
    timeout: 10000,
    headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json"
    }
});

export class TorboxProvider extends BaseDebridProvider {
    readonly name: DebridProviderName = "torbox";
    readonly displayName = "Torbox";

    isConfigured(config: UserConfig): boolean {
        return Boolean(config.torbox_apikey || config.torboxApiKey || process.env.TORBOX_API_KEY);
    }

    getApiKey(config: UserConfig): string | undefined {
        return (config.torbox_apikey as string) || (config.torboxApiKey as string) || process.env.TORBOX_API_KEY;
    }

    async checkKey(apiKey: string): Promise<DebridKeyCheckResult> {
        if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
            return { success: false, valid: false, error: "Clé API Torbox requise." };
        }
        try {
            const cleanKey = apiKey.trim();
            const res = await torboxApi.get("/user/me", {
                headers: { Authorization: `Bearer ${cleanKey}` },
                timeout: 7000
            });

            if (res.data && res.data.success && res.data.data) {
                const data = res.data.data;
                const email = data.email || "Utilisateur Torbox";
                const isPremium = Boolean(data.is_subscribed || (data.plan && data.plan > 0));
                return {
                    success: true,
                    valid: true,
                    username: email,
                    isPremium
                };
            }
            return {
                success: false,
                valid: false,
                error: res.data?.detail || "Clé API Torbox invalide ou non reconnue."
            };
        } catch (err: unknown) {
            const anyErr = err as {
                response?: { status?: number; data?: { detail?: string; message?: string } };
                message?: string;
            };
            const status = anyErr.response?.status;
            const detail = anyErr.response?.data?.detail || anyErr.response?.data?.message || anyErr.message;
            if (status === 401 || status === 403) {
                return { success: false, valid: false, error: "Clé API Torbox non autorisée (401/403)." };
            }
            return { success: false, valid: false, error: `Erreur Torbox: ${detail}` };
        }
    }

    async checkInstantAvailability(hashes: string[], apiKey: string): Promise<Record<string, boolean>> {
        if (!hashes || !Array.isArray(hashes) || hashes.length === 0 || !apiKey) {
            return {};
        }

        const uniqueHashes = [...new Set(hashes.map(h => (h || "").trim().toLowerCase()).filter(Boolean))];
        if (uniqueHashes.length === 0) return {};

        const cleanKey = apiKey.trim();
        const instantMap: Record<string, boolean> = {};

        const BATCH_SIZE = 50;
        for (let i = 0; i < uniqueHashes.length; i += BATCH_SIZE) {
            const batch = uniqueHashes.slice(i, i + BATCH_SIZE);
            try {
                const res = await torboxApi.get("/torrents/checkcached", {
                    params: {
                        hash: batch.join(","),
                        format: "object",
                        list_files: "true"
                    },
                    headers: { Authorization: `Bearer ${cleanKey}` },
                    timeout: 8000
                });

                if (res.data && res.data.success && res.data.data) {
                    const data = res.data.data;
                    if (typeof data === "object" && !Array.isArray(data)) {
                        for (const [k, v] of Object.entries(data)) {
                            if (v) instantMap[k.toLowerCase()] = true;
                        }
                    } else if (Array.isArray(data)) {
                        for (const item of data) {
                            if (item && item.hash) instantMap[item.hash.toLowerCase()] = true;
                        }
                    }
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[Torbox] Erreur lors de checkInstantTorbox (lot ${i}):`, msg);
            }
        }

        return instantMap;
    }

    async resolveStream(params: ResolveStreamParams): Promise<ResolveStreamResult> {
        const { apiKey, fileRef } = params;
        if (!fileRef || !apiKey) {
            throw new Error("Paramètres Torbox manquants pour la résolution.");
        }

        const parts = fileRef.split(":");
        const torrentId = parts[0];
        const fileId = parts[1];

        const res = await torboxApi.get("/torrents/requestdl", {
            params: {
                token: apiKey.trim(),
                torrent_id: torrentId,
                file_id: fileId,
                redirect: false
            },
            headers: { Authorization: `Bearer ${apiKey.trim()}` },
            timeout: 8000
        });

        let streamUrl: string | null = null;
        if (res.data && res.data.success && res.data.data) {
            if (typeof res.data.data === "string") {
                streamUrl = res.data.data;
            } else if (typeof res.data.data === "object") {
                streamUrl = res.data.data.url || res.data.data.download_url || res.data.data.link || null;
            }
        }

        if (!streamUrl) {
            throw new Error(`Impossible d'obtenir le lien de streaming Torbox (${torrentId}:${fileId})`);
        }

        return { url: streamUrl, streamable: true };
    }
}

export const torboxProvider = new TorboxProvider();
