import express, { Express, Request, Response, NextFunction } from "express";
import { stremioRouter } from "./routes/stremio.js";
import { resolveRouter } from "./routes/resolve.js";
import { adminRouter } from "./routes/admin.js";
import { apiRouter } from "./routes/api.js";
import { uiRouter } from "./routes/ui.js";

export function createApp(): Express {
    const app = express();

    const rawTrust = (process.env.TRUST_PROXY || "").trim().toLowerCase();
    if (rawTrust === "true") {
        app.set("trust proxy", true);
    } else if (rawTrust && !isNaN(Number(rawTrust))) {
        app.set("trust proxy", Number(rawTrust));
    } else {
        app.set("trust proxy", false);
    }

    const MAX_BODY_SIZE = "100kb";
    app.use(express.json({ limit: MAX_BODY_SIZE }));
    app.use(express.urlencoded({ extended: true, limit: MAX_BODY_SIZE }));

    const CSP_DIRECTIVES = [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "form-action 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: https:",
        "connect-src 'self'",
        "frame-src https:"
    ].join("; ");

    app.disable("x-powered-by");

    app.use((_req: Request, res: Response, next: NextFunction) => {
        res.setHeader("Content-Security-Policy", CSP_DIRECTIVES);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
        next();
    });

    function isOriginAllowed(origin: string, reqHost?: string): boolean {
        let parsedOrigin: URL;
        try {
            parsedOrigin = new URL(origin);
        } catch {
            return false;
        }
        const originHost = parsedOrigin.host.toLowerCase();
        const isSameHost = Boolean(reqHost) && originHost === String(reqHost).toLowerCase();
        const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsedOrigin.hostname.toLowerCase());
        const customAllowed = (process.env.CORS_ALLOWED_ORIGINS || "")
            .split(",")
            .map(o => o.trim().toLowerCase())
            .filter(Boolean);
        const isCustomAllowed = customAllowed.includes(origin.toLowerCase()) || customAllowed.includes(originHost);
        return isSameHost || isLocal || isCustomAllowed;
    }

    app.use((req: Request, res: Response, next: NextFunction) => {
        const pathUrl = req.path || "";

        const isCacheable = pathUrl.includes("/meta/") || pathUrl === "/logo.png" || pathUrl === "/background.png";
        if (isCacheable) {
            res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
        } else {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        }

        const isStremioRoute =
            pathUrl.includes("/manifest.json") ||
            pathUrl.includes("/catalog/") ||
            pathUrl.includes("/meta/") ||
            pathUrl.includes("/stream/") ||
            pathUrl === "/logo.png" ||
            pathUrl === "/background.png";

        if (isStremioRoute) {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Headers", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
            if (req.method === "OPTIONS") {
                res.sendStatus(204);
                return;
            }
            return next();
        }

        if (pathUrl.startsWith("/api/")) {
            const origin = req.headers.origin;
            if (!origin) {
                return next();
            }
            if (isOriginAllowed(origin, req.get("host"))) {
                res.setHeader("Access-Control-Allow-Origin", origin);
                res.setHeader("Access-Control-Allow-Credentials", "true");
                res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token, Accept");
                res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
                if (req.method === "OPTIONS") {
                    res.sendStatus(204);
                    return;
                }
                return next();
            }
            res.status(403).json({ error: "CORS Forbidden: Origine non autorisée pour l'API." });
            return;
        }

        const origin = req.headers.origin;
        if (origin && isOriginAllowed(origin, req.get("host"))) {
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Vary", "Origin");
            res.setHeader("Access-Control-Allow-Headers", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        }
        if (req.method === "OPTIONS") {
            res.sendStatus(204);
            return;
        }
        next();
    });

    // Enregistrement des routes modulaires
    app.use("/resolve", resolveRouter);
    app.use("/api/admin", adminRouter);
    app.use("/api", apiRouter);
    app.use(stremioRouter);
    app.use(uiRouter);

    return app;
}
