import { Request, Response } from "express";
import resolverModule from "../../../lib/resolver.js";

export async function handleResolve(req: Request, res: Response): Promise<void> {
    return resolverModule.handleResolve(req, res);
}

export function pickBestVideoFile(files: unknown[], imdbId = ""): unknown {
    return resolverModule.pickBestVideoFile(files, imdbId);
}

export function testStreamAlive(url: string): Promise<boolean> {
    return resolverModule.testStreamAlive(url);
}

export function resolveUserApiKey(userRef: string): string | null {
    return resolverModule.resolveUserApiKey(userRef);
}

export function resolveUserConfig(userRef: string): unknown {
    return resolverModule.resolveUserConfig(userRef);
}
