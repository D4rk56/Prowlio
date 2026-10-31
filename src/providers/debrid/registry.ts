import { IDebridProvider, DebridProviderName } from "../../types/debrid.js";
import { UserConfig } from "../../types/config.js";
import { allDebridProvider } from "./alldebrid.js";
import { realDebridProvider } from "./realdebrid.js";
import { torboxProvider } from "./torbox.js";
import { debridLinkProvider } from "./debridlink.js";

export class DebridRegistry {
    private providers: Map<DebridProviderName, IDebridProvider> = new Map();

    constructor() {
        this.register(allDebridProvider);
        this.register(realDebridProvider);
        this.register(torboxProvider);
        this.register(debridLinkProvider);
    }

    register(provider: IDebridProvider): void {
        this.providers.set(provider.name, provider);
    }

    get(name: DebridProviderName): IDebridProvider | undefined {
        return this.providers.get(name);
    }

    getAll(): IDebridProvider[] {
        return Array.from(this.providers.values());
    }

    getConfiguredProviders(config: UserConfig): IDebridProvider[] {
        return this.getAll().filter(p => p.isConfigured(config));
    }
}

export const debridRegistry = new DebridRegistry();
