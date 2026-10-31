import { Router, Request, Response, NextFunction } from "express";
import stremioModule from "../../../lib/stremio.js";
import { db } from "../../db/client.js";
import { runWithUser } from "../../core/logger.js";
import { StremioManifest, CatalogResponse, StremioMetaDetail, StreamResponse } from "../../types/stremio.js";
import { APP_ID, APP_NAME } from "../../config/constants.js";

export const stremioRouter = Router();

function isReasonableId(id: unknown): boolean {
    return typeof id === "string" && id.length > 0 && id.length <= 2000 && !/[\u0000-\u001f]/.test(id);
}

function getBaseUrl(req: Request): string {
    const forwarded = req.headers["x-forwarded-proto"];
    const proto = Array.isArray(forwarded)
        ? forwarded[0]
        : typeof forwarded === "string"
          ? forwarded.split(",")[0].trim()
          : req.protocol;
    return `${proto || "http"}://${req.get("host")}`;
}

stremioRouter.use("/:uuid", (req: Request, res: Response, next: NextFunction) => {
    const uuid = String(req.params.uuid || "");
    if (uuid && uuid.length === 36 && uuid.includes("-")) {
        const user = db.getUserByUuid(uuid);
        const tag = user ? { uuid: user.uuid, pseudo: user.pseudo || "Utilisateur" } : { uuid, pseudo: "Inconnu" };
        return runWithUser(tag, () => next());
    }
    next();
});

stremioRouter.get("/:uuid/manifest.json", (req: Request, res: Response) => {
    const uuid = String(req.params.uuid || "");
    const config = db.getUserConfig(uuid);
    if (!config) return res.status(404).json({ error: "Addon introuvable pour cet identifiant." });
    const baseUrl = getBaseUrl(req);
    const manifest: StremioManifest = stremioModule.handleManifest(config, baseUrl, uuid);
    manifest.name = APP_NAME;
    manifest.id = APP_ID;
    res.json(manifest);
});

stremioRouter.get("/:uuid/catalog/:type/:id.json", async (req: Request, res: Response) => {
    const uuid = String(req.params.uuid || "");
    const config = db.getUserConfig(uuid);
    if (!config) return res.status(404).json({ error: "Addon introuvable." });
    if (!isReasonableId(req.params.id)) return res.status(400).json({ error: "Identifiant invalide." });
    try {
        const extra = req.query && Object.keys(req.query).length > 0 ? req.query : null;
        const result: CatalogResponse = await stremioModule.handleCatalog(
            config,
            req.params.type,
            req.params.id,
            null,
            extra
        );
        res.json(result);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Catalog] Erreur ${req.params.id}:`, msg);
        res.json({ metas: [] });
    }
});

stremioRouter.get("/:uuid/catalog/:type/:id/:extra.json", async (req: Request, res: Response) => {
    const uuid = String(req.params.uuid || "");
    const config = db.getUserConfig(uuid);
    if (!config) return res.status(404).json({ error: "Addon introuvable." });
    if (!isReasonableId(req.params.id)) return res.status(400).json({ error: "Identifiant invalide." });
    try {
        const extraParam = req.params.extra;
        const extraObj = req.query && Object.keys(req.query).length > 0 ? { extraParam, ...req.query } : extraParam;
        const result: CatalogResponse = await stremioModule.handleCatalog(
            config,
            req.params.type,
            req.params.id,
            null,
            extraObj
        );
        res.json(result);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Catalog] Erreur ${req.params.id} (${req.params.extra}):`, msg);
        res.json({ metas: [] });
    }
});

stremioRouter.get("/:uuid/meta/:type/:id.json", async (req: Request, res: Response) => {
    const uuid = String(req.params.uuid || "");
    const config = db.getUserConfig(uuid);
    if (!config) return res.status(404).json({ error: "Addon introuvable." });
    if (!isReasonableId(req.params.id)) return res.status(400).json({ error: "Identifiant invalide." });
    try {
        const result: { meta: StremioMetaDetail } = await stremioModule.handleMeta(
            config,
            req.params.type,
            req.params.id,
            null
        );
        res.json(result);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Meta] Erreur ${req.params.id}:`, msg);
        res.status(500).json({ error: msg });
    }
});

stremioRouter.get("/:uuid/stream/:type/:id.json", async (req: Request, res: Response) => {
    const uuid = String(req.params.uuid || "");
    const config = db.getUserConfig(uuid);
    if (!config) return res.status(404).json({ error: "Addon introuvable." });
    if (!isReasonableId(req.params.id)) return res.status(400).json({ error: "Identifiant invalide." });
    try {
        const baseUrl = getBaseUrl(req);
        const startedAt = Date.now();
        const result: StreamResponse = await stremioModule.handleStream(
            config,
            req.params.type,
            req.params.id,
            null,
            baseUrl,
            uuid
        );
        console.log(
            `[Stream] ${req.params.type}/${req.params.id} → ${
                Array.isArray(result.streams) ? result.streams.length : 0
            } flux en ${Date.now() - startedAt} ms`
        );
        res.json(result);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Stream] Erreur ${req.params.id}:`, msg);
        res.json({ streams: [] });
    }
});
