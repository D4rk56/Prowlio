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
import { makeLRU } from "../../core/cache.js";

const REALDEBRID_API_BASE = "https://api.real-debrid.com/rest/1.0";

const rdApi = axios.create({
    baseURL: REALDEBRID_API_BASE,
    timeout: 10000,
    headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json"
    }
});

const rdInstantCache = makeLRU<string, boolean>(1000, 3600_000);

export class RealDebridProvider extends BaseDebridProvider {
    readonly name: DebridProviderName = "realdebrid";
    readonly displayName = "Real-Debrid";

    isConfigured(config: UserConfig): boolean {
        return Boolean(config.rd_apikey || config.realdebridApiKey || config.rdApiKey);
    }

    getApiKey(config: UserConfig): string | undefined {
        return (config.rd_apikey as string) || (config.realdebridApiKey as string) || (config.rdApiKey as string);
    }

    async checkKey(apiKey: string): Promise<DebridKeyCheckResult> {
        if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 5) {
            return { success: false, valid: false, error: "Clé Real-Debrid manquante ou invalide" };
        }
        const cleanKey = apiKey.trim();
        try {
            const res = await rdApi.get("/user", {
                headers: { Authorization: `Bearer ${cleanKey}` }
            });
            if (res.status === 200 && res.data && res.data.id) {
                const isPremium = res.data.type === "premium" && new Date(res.data.expiration).getTime() > Date.now();
                return {
                    success: true,
                    valid: true,
                    username: res.data.username || `User_${res.data.id}`,
                    isPremium,
                    expiration: res.data.expiration || undefined
                };
            }
            return { success: false, valid: false, error: "Réponse utilisateur Real-Debrid inattendue" };
        } catch (err: unknown) {
            const anyErr = err as { response?: { status?: number }; message?: string; code?: string };
            const status = anyErr.response ? anyErr.response.status : undefined;
            let errMsg = "Erreur de connexion à Real-Debrid";
            if (status === 401) errMsg = "Clé d'API Real-Debrid invalide ou révoquée";
            else if (status === 403) errMsg = "Accès refusé par Real-Debrid (compte suspendu ou IP bloquée)";
            else if (anyErr.code === "ECONNABORTED" || (anyErr.message && anyErr.message.includes("timeout")))
                errMsg = "Délai d'attente dépassé (timeout Real-Debrid)";
            return { success: false, valid: false, error: errMsg };
        }
    }

    async checkInstantAvailability(hashes: string[], apiKey: string): Promise<Record<string, boolean>> {
        if (!hashes || !Array.isArray(hashes) || hashes.length === 0 || !apiKey) {
            return {};
        }

        const cleanHashes = hashes
            .map(h =>
                String(h || "")
                    .trim()
                    .toLowerCase()
            )
            .filter(h => /^[a-f0-9]{40}$/.test(h));

        if (cleanHashes.length === 0) return {};

        const result: Record<string, boolean> = {};
        const toQuery: string[] = [];

        for (const h of cleanHashes) {
            const cached = rdInstantCache.get(h);
            if (cached !== undefined) {
                result[h] = cached;
            } else {
                toQuery.push(h);
            }
        }

        if (toQuery.length === 0) return result;

        const BATCH_SIZE = 50;
        for (let i = 0; i < toQuery.length; i += BATCH_SIZE) {
            const batch = toQuery.slice(i, i + BATCH_SIZE);
            try {
                const endpoint = `/torrents/instantAvailability/${batch.join("/")}`;
                const res = await rdApi.get(endpoint, {
                    headers: { Authorization: `Bearer ${apiKey.trim()}` },
                    timeout: 5000
                });

                if (res.status === 200 && res.data && typeof res.data === "object") {
                    for (const h of batch) {
                        const hashData = res.data[h];
                        let isInstant = false;
                        if (hashData && Array.isArray(hashData.rd) && hashData.rd.length > 0) {
                            isInstant = true;
                        }
                        result[h] = isInstant;
                        rdInstantCache.set(h, isInstant);
                    }
                }
            } catch {
                for (const h of batch) {
                    if (result[h] === undefined) {
                        result[h] = false;
                    }
                }
            }
        }

        return result;
    }

    async resolveStream(params: ResolveStreamParams): Promise<ResolveStreamResult> {
        const { apiKey, fileRef } = params;
        if (!fileRef || !apiKey) {
            throw new Error("Paramètres Real-Debrid manquants pour la résolution.");
        }

        let magnetUri = fileRef;
        let hash = "";

        if (/^[a-f0-9]{40}$/i.test(fileRef)) {
            hash = fileRef.toLowerCase();
            magnetUri = `magnet:?xt=urn:btih:${hash}`;
        } else if (fileRef.startsWith("magnet:")) {
            const m = fileRef.match(/btih:([a-f0-9]{40})/i);
            if (m) hash = m[1].toLowerCase();
        }

        if (hash && this.isTargetDead(hash)) {
            throw new Error(`Cible Real-Debrid ${hash} en quarantaine.`);
        }

        const paramsPost = new URLSearchParams();
        paramsPost.append("magnet", magnetUri);

        const addRes = await rdApi.post("/torrents/addMagnet", paramsPost.toString(), {
            headers: {
                Authorization: `Bearer ${apiKey.trim()}`,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });

        if (!addRes.data || !addRes.data.id) {
            if (hash) this.markTargetDead(hash, "échec ajout magnet Real-Debrid");
            throw new Error("Échec de l'ajout du magnet sur Real-Debrid.");
        }

        const torrentId = addRes.data.id;
        let infoRes = await rdApi.get(`/torrents/info/${torrentId}`, {
            headers: { Authorization: `Bearer ${apiKey.trim()}` },
            timeout: 5000
        });
        let info = infoRes.data;

        if (info.status === "waiting_files_selection" && Array.isArray(info.files)) {
            const videoExts = /\.(mp4|mkv|avi|mov|wmv|ts|m4v|webm)$/i;
            const videoFiles = info.files.filter((f: { path?: string }) => videoExts.test(f.path || ""));
            const selectedIds =
                videoFiles.length > 0
                    ? videoFiles.map((f: { id: string | number }) => f.id)
                    : info.files.map((f: { id: string | number }) => f.id);

            const selectParams = new URLSearchParams();
            selectParams.append("files", selectedIds.join(","));
            await rdApi.post(`/torrents/selectFiles/${torrentId}`, selectParams.toString(), {
                headers: {
                    Authorization: `Bearer ${apiKey.trim()}`,
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            });

            infoRes = await rdApi.get(`/torrents/info/${torrentId}`, {
                headers: { Authorization: `Bearer ${apiKey.trim()}` },
                timeout: 5000
            });
            info = infoRes.data;
        }

        if (!info || !Array.isArray(info.links) || info.links.length === 0) {
            await rdApi
                .delete(`/torrents/delete/${torrentId}`, {
                    headers: { Authorization: `Bearer ${apiKey.trim()}` }
                })
                .catch(() => {});
            if (hash) this.markTargetDead(hash, "aucun lien disponible");
            throw new Error("Aucun lien disponible sur Real-Debrid.");
        }

        const targetLink = info.links[0];
        const unrestrictParams = new URLSearchParams();
        unrestrictParams.append("link", targetLink);

        const unresRes = await rdApi.post("/unrestrict/link", unrestrictParams.toString(), {
            headers: {
                Authorization: `Bearer ${apiKey.trim()}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            timeout: 7000
        });

        if (unresRes.data && unresRes.data.download) {
            return {
                url: unresRes.data.download,
                filename: unresRes.data.filename,
                streamable: Boolean(unresRes.data.streamable)
            };
        }

        if (hash) this.markTargetDead(hash, "débridage lien échoué");
        throw new Error("Échec du débridage du lien direct sur Real-Debrid.");
    }
}

export const realDebridProvider = new RealDebridProvider();
