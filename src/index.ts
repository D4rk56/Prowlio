import { validateEnv } from "./config/env.js";
import { initConsoleInterceptors, logger } from "./core/logger.js";
import { loadAnimeMapping } from "./core/anime/mapper.js";
import { createApp } from "./server/app.js";
import { APP_NAME } from "./config/constants.js";

validateEnv();
initConsoleInterceptors();

try {
    loadAnimeMapping();
} catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn("AnimeMapping", `Impossible de charger la table anime: ${msg}`);
}

const app = createApp();
const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, () => {
    logger.info("Server", `${APP_NAME} démarré avec succès sur le port ${PORT}`);
    console.log(`🚀 ${APP_NAME} est en ligne : http://localhost:${PORT}`);
});

function gracefulShutdown(signal: string): void {
    logger.info("Server", `Signal ${signal} reçu, arrêt en cours...`);
    server.close(() => {
        logger.info("Server", "Serveur HTTP arrêté proprement.");
        process.exit(0);
    });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export { app, server };
