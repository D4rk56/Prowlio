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

const DEBRIDLINK_API_BASE = "https://debrid-link.com/api/v2";

const dlApi = axios.create({
    baseURL: DEBRIDLINK_API_BASE,
    timeout: 10000,
    headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json"
    }
});

const dlInstantCache = makeLRU<string, boolean>(1000, 3600_000);

export class DebridLinkProvider extends BaseDebridProvider {
    readonly name: DebridProviderName = "debridlink";
    readonly displayName = "Debrid-Link";

    isConfigured(config: UserConfig): boolean {
        return Boolean(config.debridlink_apikey || config.debridlinkApiKey || config.dlApiKey);
    }

    getApiKey(config: UserConfig): string | undefined {
        return (
            (config.debridlink_apikey as string) || (config.debridlinkApiKey as string) || (config.dlApiKey as string)
        );
    }

    async checkKey(apiKey: string): Promise<DebridKeyCheckResult> {
        if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 5) {
            return { success: false, valid: false, error: "Clé Debrid-Link manquante ou invalide" };
        }
        const cleanKey = apiKey.trim();
        try {
            const res = await dlApi.get("/account/infos", {
                headers: { Authorization: `Bearer ${cleanKey}` }
            });
            if (res.status === 200 && res.data && res.data.success && res.data.value) {
                const val = res.data.value;
                const isPremium = Boolean(val.premiumLeft && val.premiumLeft > 0);
                return {
                    success: true,
                    valid: true,
                    username: val.pseudo || "Utilisateur Debrid-Link",
                    isPremium
                };
            }
            return { success: false, valid: false, error: "Réponse utilisateur Debrid-Link inattendue" };
        } catch (err: unknown) {
            const anyErr = err as { response?: { status?: number }; message?: string; code?: string };
            const status = anyErr.response ? anyErr.response.status : undefined;
            let errMsg = "Erreur de connexion à Debrid-Link";
            if (status === 401) errMsg = "Clé d'API Debrid-Link invalide ou expirée";
            else if (status === 403) errMsg = "Accès refusé par Debrid-Link";
            else if (anyErr.code === "ECONNABORTED" || (anyErr.message && anyErr.message.includes("timeout")))
                errMsg = "Délai d'attente dépassé (timeout Debrid-Link)";
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
            const cached = dlInstantCache.get(h);
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
                const endpoint = `/seedbox/cached?url=${batch.join(",")}`;
                const res = await dlApi.get(endpoint, {
                    headers: { Authorization: `Bearer ${apiKey.trim()}` },
                    timeout: 5000
                });

                if (res.status === 200 && res.data && res.data.success && res.data.value) {
                    const map = res.data.value as Record<string, boolean>;
                    for (const h of batch) {
                        const isInstant = Boolean(map[h]);
                        result[h] = isInstant;
                        dlInstantCache.set(h, isInstant);
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
            throw new Error("Paramètres Debrid-Link manquants pour la résolution.");
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
            throw new Error(`Cible Debrid-Link ${hash} en quarantaine.`);
        }

        const addRes = await dlApi.post(
            "/seedbox/add",
            { url: magnetUri, async: true },
            {
                headers: { Authorization: `Bearer ${apiKey.trim()}` },
                timeout: 7000
            }
        );

        if (!addRes.data || !addRes.data.success || !addRes.data.value) {
            if (hash) this.markTargetDead(hash, "échec ajout Debrid-Link");
            throw new Error("Échec de l'ajout du torrent sur Debrid-Link.");
        }

        const added = addRes.data.value;
        const files = Array.isArray(added.files) ? added.files : [];
        if (files.length === 0) {
            if (hash) this.markTargetDead(hash, "aucun fichier dans le torrent");
            throw new Error("Aucun fichier détecté sur Debrid-Link.");
        }

        const videoFiles = files.filter((f: { name?: string }) => /\.(mp4|mkv|avi|mov|ts|m4v)$/i.test(f.name || ""));
        const targetFile = videoFiles.length > 0 ? videoFiles[0] : files[0];

        const directUrl = targetFile.downloadUrl || targetFile.streamUrl;
        if (directUrl) {
            return {
                url: directUrl,
                filename: targetFile.name,
                streamable: true
            };
        }

        await dlApi
            .delete(`/seedbox/${added.id}/remove`, {
                headers: { Authorization: `Bearer ${apiKey.trim()}` }
            })
            .catch(() => {});

        if (hash) this.markTargetDead(hash, "URL de stream Debrid-Link absente");
        throw new Error("Flux Debrid-Link non prêt pour streaming immédiat.");
    }
}

export const debridLinkProvider = new DebridLinkProvider();
