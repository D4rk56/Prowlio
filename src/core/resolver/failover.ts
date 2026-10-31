import { IDebridProvider } from "../../types/debrid.js";
import { UserConfig } from "../../types/config.js";
import { debridRegistry } from "../../providers/debrid/registry.js";

export async function attemptProviderCascade(
    fileRef: string,
    imdbId: string,
    config: UserConfig
): Promise<{ url: string; provider: string } | null> {
    const configuredProviders = debridRegistry.getConfiguredProviders(config);
    for (const provider of configuredProviders) {
        const apiKey = provider.getApiKey(config);
        if (!apiKey) continue;
        try {
            const result = await provider.resolveStream({
                apiKey,
                fileRef,
                imdbId,
                userConfig: config
            });
            if (result && result.url) {
                return { url: result.url, provider: provider.displayName };
            }
        } catch {
            // Tentative échouée, on passe au fournisseur suivant en cascade
            continue;
        }
    }
    return null;
}
