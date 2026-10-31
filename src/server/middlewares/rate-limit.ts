import rateLimit from "express-rate-limit";

export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, trustProxy: false },
    message: { error: "Trop de tentatives d'authentification. Veuillez réessayer dans 15 minutes." }
});

export const apiCheckLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, trustProxy: false },
    message: { error: "Trop de requêtes de vérification d'API. Veuillez patienter une minute." }
});

export const adminActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, trustProxy: false },
    message: { error: "Trop d'actions administratives rapprochées. Veuillez patienter une minute." }
});

export const resolveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, trustProxy: false },
    message: { error: "Trop de résolutions de flux. Veuillez patienter une minute." }
});
