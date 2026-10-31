import { SocksProxyAgent } from "socks-proxy-agent";
import { ProxyAgent } from "proxy-agent";
import { makeLRU, LRUCache } from "../../core/cache.js";
import {
    IDebridProvider,
    DebridProviderName,
    DebridKeyCheckResult,
    ResolveStreamParams,
    ResolveStreamResult
} from "../../types/debrid.js";
import { UserConfig } from "../../types/config.js";

export function createProxyAgent(rawUrl?: string): SocksProxyAgent | ProxyAgent | null {
    if (!rawUrl || typeof rawUrl !== "string") return null;
    let url = rawUrl.trim();
    if (!url) return null;

    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
        url = `http://${url}`;
    }

    try {
        const parsed = new URL(url);
        const protocol = parsed.protocol.toLowerCase();

        if (protocol.startsWith("socks")) {
            return new SocksProxyAgent(url, { timeout: 8000 });
        }

        return new ProxyAgent({
            getProxyForUrl: () => url
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[Proxy] Impossible d'analyser l'URL de proxy (${rawUrl}):`, msg);
        return null;
    }
}

export abstract class BaseDebridProvider implements IDebridProvider {
    abstract readonly name: DebridProviderName;
    abstract readonly displayName: string;

    protected deadTargets: LRUCache<string, { reason: string; at: number }>;
    protected deadTargetDurationMs = 10 * 60 * 1000;

    constructor() {
        this.deadTargets = makeLRU<string, { reason: string; at: number }>(500, this.deadTargetDurationMs);
    }

    abstract isConfigured(config: UserConfig): boolean;
    abstract getApiKey(config: UserConfig): string | undefined;
    abstract checkKey(apiKey: string): Promise<DebridKeyCheckResult>;
    abstract checkInstantAvailability(hashes: string[], apiKey: string): Promise<Record<string, boolean>>;
    abstract resolveStream(params: ResolveStreamParams): Promise<ResolveStreamResult>;

    isTargetDead(targetRef: string): boolean {
        if (!targetRef) return false;
        return this.deadTargets.has(String(targetRef).toLowerCase());
    }

    markTargetDead(targetRef: string, reason: string): void {
        if (!targetRef) return;
        const key = String(targetRef).toLowerCase();
        if (this.deadTargets.has(key)) return;
        this.deadTargets.set(key, { reason: reason || "indisponible", at: Date.now() });
        console.warn(
            `[${this.displayName}] Cible ${key} mise en quarantaine ${this.deadTargetDurationMs / 60000} min (${reason || "indisponible"}).`
        );
    }

    resetDeadTargets(): void {
        this.deadTargets.clear();
    }
}
