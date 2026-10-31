import { Router, Request, Response } from "express";
import { resolveLimiter } from "../middlewares/rate-limit.js";
import { handleResolve } from "../../core/resolver/lazy-resolver.js";
import { runWithUser } from "../../core/logger.js";
import { db } from "../../db/client.js";

export const resolveRouter = Router();

resolveRouter.get("/:userRef/:imdbId/:fileRef(*)", resolveLimiter, (req: Request, res: Response) => {
    const userRef = String(req.params.userRef || "");
    const user = userRef && userRef.length === 36 && userRef.includes("-") ? db.getUserByUuid(userRef) : null;
    const tag = user ? { uuid: user.uuid, pseudo: user.pseudo || "Utilisateur" } : { uuid: userRef, pseudo: "Client" };
    return runWithUser(tag, () => handleResolve(req, res));
});
