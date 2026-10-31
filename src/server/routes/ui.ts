import { Router, Request, Response, NextFunction } from "express";
import uiModule from "../../../lib/ui.js";
import { UUID_REGEX } from "../../config/constants.js";

export const uiRouter = Router();

uiRouter.get("/logo.png", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(uiModule.LOGO_SVG);
});

uiRouter.get("/background.png", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(uiModule.BACKGROUND_SVG);
});

uiRouter.get("/", (_req: Request, res: Response) => {
    res.send(uiModule.renderConfigPage("register"));
});

uiRouter.get("/configure", (_req: Request, res: Response) => {
    res.send(uiModule.renderConfigPage("configure"));
});

uiRouter.get("/:uuid/configure", (req: Request, res: Response) => {
    const rawUuid = String(req.params.uuid || "");
    const uuid = UUID_REGEX.test(rawUuid) ? rawUuid : "";
    res.send(uiModule.renderConfigPage("configure", uuid));
});

uiRouter.get("/admin", (_req: Request, res: Response) => {
    res.send(uiModule.renderAdminPage());
});

uiRouter.get("/:uuid", (req: Request, res: Response, next: NextFunction) => {
    const rawUuid = String(req.params.uuid || "");
    if (UUID_REGEX.test(rawUuid)) {
        res.send(uiModule.renderConfigPage("configure", rawUuid));
        return;
    }
    next();
});
