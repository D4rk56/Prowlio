import { Request, Response, NextFunction } from "express";

const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const activeAdminTokens = new Map<string, number>();

export function issueAdminToken(token: string): void {
    activeAdminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
}

export function revokeAdminToken(token: string): boolean {
    return activeAdminTokens.delete(token);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    const token = req.headers["x-admin-token"] as string | undefined;
    if (!token) {
        res.status(401).json({ error: "Session administrateur non autorisée ou expirée." });
        return;
    }
    const expiresAt = activeAdminTokens.get(token);
    if (!expiresAt) {
        res.status(401).json({ error: "Session administrateur non autorisée ou expirée." });
        return;
    }
    if (Date.now() > expiresAt) {
        activeAdminTokens.delete(token);
        res.status(401).json({ error: "Session administrateur non autorisée ou expirée." });
        return;
    }
    activeAdminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
    next();
}
