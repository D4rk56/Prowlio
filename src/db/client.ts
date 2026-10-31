import path from "node:path";
import { UserEntity, UserConfig, SystemSettings } from "../types/config.js";
import { SearchTorrentResult } from "../types/indexer.js";

// Charger le module de base SQLite existant de manière sécurisée
import dbModule from "../../lib/db.js";

export interface UserStats {
    totalUsers: number;
    activeUsers: number;
}

export interface CachedTorrentRecord {
    imdbId: string;
    infoHash: string;
    title: string;
    size: number;
    seeders: number;
    isInstant: number;
    provider: string;
    season?: number;
    episode?: number;
    resolution?: string;
    languages?: string;
    quality?: string;
}

export const db = {
    createUser: (uuid: string, passwordHash: string, configEncrypted: string, pseudo = ""): boolean =>
        dbModule.createUser(uuid, passwordHash, configEncrypted, pseudo),

    getUserByUuid: (uuid: string): UserEntity | null => dbModule.getUserByUuid(uuid),

    getUserConfig: (uuid: string): UserConfig | null => dbModule.getUserConfig(uuid),

    updateUserConfig: (uuid: string, configEncrypted: string): boolean =>
        dbModule.updateUserConfig(uuid, configEncrypted),

    updateUserPassword: (uuid: string, newPasswordHash: string): boolean =>
        dbModule.updateUserPassword(uuid, newPasswordHash),

    deleteUser: (uuid: string): boolean => dbModule.deleteUser(uuid),

    isPseudoTaken: (pseudo: string, excludeUuid = ""): boolean => dbModule.isPseudoTaken(pseudo, excludeUuid),

    getAllUsers: (sortBy = "newest"): UserEntity[] => dbModule.getAllUsers(sortBy),

    getSystemSettings: (): SystemSettings => dbModule.getSystemSettings(),

    updateSystemSettings: (settings: Partial<SystemSettings>): boolean => dbModule.updateSystemSettings(settings),

    upsertCachedTorrent: (torrent: CachedTorrentRecord): void => dbModule.upsertCachedTorrent(torrent),

    getCachedTorrentsByImdb: (imdbId: string): SearchTorrentResult[] => dbModule.getCachedTorrentsByImdb(imdbId),

    deleteCachedTorrent: (imdbId: string, infoHash: string): void => dbModule.deleteCachedTorrent(imdbId, infoHash),

    purgeOldCachedTorrents: (days: number): number => dbModule.purgeOldCachedTorrents(days),

    getSharedProwlarrInstances: () => dbModule.getSharedProwlarrInstances(),

    asyncTouchUserActivity: (uuid: string): void => dbModule.asyncTouchUserActivity(uuid)
};

export default db;
