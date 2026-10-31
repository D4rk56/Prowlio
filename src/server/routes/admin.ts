import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import { requireAdmin, issueAdminToken, revokeAdminToken } from "../middlewares/auth.js";
import { authLimiter, adminActionLimiter } from "../middlewares/rate-limit.js";
import { db } from "../../db/client.js";
import { getLogs, clearLogs } from "../../core/logger.js";
import { normalizeSiteSettings } from "../../core/security/sanitize.js";

export const adminRouter = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

adminRouter.post("/login", authLimiter, (req: Request, res: Response) => {
    const { password } = req.body;
    let isValid = false;
    if (typeof password === "string" && typeof ADMIN_PASSWORD === "string") {
        const passBuf = Buffer.from(password);
        const adminBuf = Buffer.from(ADMIN_PASSWORD);
        if (passBuf.length === adminBuf.length) {
            isValid = crypto.timingSafeEqual(passBuf, adminBuf);
        }
    }
    if (isValid) {
        const token = crypto.randomBytes(24).toString("hex");
        issueAdminToken(token);
        return res.json({ success: true, token });
    }
    return res.status(401).json({ error: "Mot de passe administrateur incorrect." });
});

adminRouter.post("/logout", requireAdmin, (req: Request, res: Response) => {
    const token = req.headers["x-admin-token"] as string | undefined;
    if (token) revokeAdminToken(token);
    res.json({ success: true });
});

adminRouter.get("/stats", requireAdmin, (_req: Request, res: Response) => {
    const users = db.getAllUsers();
    res.json({
        totalUsers: users.length,
        nodeVersion: process.version,
        memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        uptimeSeconds: Math.round(process.uptime())
    });
});

adminRouter.get("/users", requireAdmin, (req: Request, res: Response) => {
    const sortBy = (req.query.sortBy as string) || "newest";
    const users = db.getAllUsers(sortBy);
    res.json(users);
});

adminRouter.delete("/users/:uuid", requireAdmin, (req: Request, res: Response) => {
    const uuid = String(req.params.uuid);
    db.deleteUser(uuid);
    res.json({ success: true });
});

adminRouter.get("/logs", requireAdmin, (req: Request, res: Response) => {
    const { level, limit, search } = req.query;
    res.json(
        getLogs({
            level: level as string,
            limit: Number(limit) || 150,
            search: search as string
        })
    );
});

adminRouter.post("/logs/clear", requireAdmin, (_req: Request, res: Response) => {
    clearLogs();
    res.json({ success: true });
});

adminRouter.get("/settings", requireAdmin, (_req: Request, res: Response) => {
    res.json(db.getSystemSettings());
});

adminRouter.post("/settings", requireAdmin, (req: Request, res: Response) => {
    const sanitized = normalizeSiteSettings(req.body);
    const updated = db.updateSystemSettings(sanitized);
    res.json({ success: true, settings: updated });
});
