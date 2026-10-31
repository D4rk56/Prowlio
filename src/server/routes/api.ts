import { Router, Request, Response } from "express";
import { apiCheckLimiter, authLimiter } from "../middlewares/rate-limit.js";
import { debridRegistry } from "../../providers/debrid/registry.js";
import { checkJackettConnectivity } from "../../providers/indexers/jackett.js";
import { db } from "../../db/client.js";

export const apiRouter = Router();

apiRouter.post("/check/alldebrid", apiCheckLimiter, async (req: Request, res: Response) => {
    const { apiKey } = req.body;
    const provider = debridRegistry.get("alldebrid");
    if (!provider) return res.status(500).json({ error: "Fournisseur non trouvé" });
    const result = await provider.checkKey(apiKey);
    res.json(result);
});

apiRouter.post("/check/torbox", apiCheckLimiter, async (req: Request, res: Response) => {
    const { apiKey } = req.body;
    const provider = debridRegistry.get("torbox");
    if (!provider) return res.status(500).json({ error: "Fournisseur non trouvé" });
    const result = await provider.checkKey(apiKey);
    res.json(result);
});

apiRouter.post("/check/realdebrid", apiCheckLimiter, async (req: Request, res: Response) => {
    const { apiKey } = req.body;
    const provider = debridRegistry.get("realdebrid");
    if (!provider) return res.status(500).json({ error: "Fournisseur non trouvé" });
    const result = await provider.checkKey(apiKey);
    res.json(result);
});

apiRouter.post("/check/debridlink", apiCheckLimiter, async (req: Request, res: Response) => {
    const { apiKey } = req.body;
    const provider = debridRegistry.get("debridlink");
    if (!provider) return res.status(500).json({ error: "Fournisseur non trouvé" });
    const result = await provider.checkKey(apiKey);
    res.json(result);
});

apiRouter.post("/check/jackett", apiCheckLimiter, async (req: Request, res: Response) => {
    const { url, key } = req.body;
    const result = await checkJackettConnectivity(url, key);
    res.json(result);
});

apiRouter.get("/stats", apiCheckLimiter, (_req: Request, res: Response) => {
    const users = db.getAllUsers();
    res.json({
        totalUsers: users.length,
        active24h: users.length,
        active10m: users.length
    });
});
