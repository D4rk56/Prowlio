import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const DATA_DIR = path.resolve(process.cwd(), "data");
const SECRET_FILE = path.join(DATA_DIR, ".app_secret");

export function secureFilePermissions(filePath: string): boolean {
    if (!filePath || !fs.existsSync(filePath)) return false;
    try {
        if (process.platform !== "win32") {
            fs.chmodSync(filePath, 0o600);
            const stats = fs.statSync(filePath);
            const mode = stats.mode & 0o777;
            if (mode !== 0o600) {
                console.warn(
                    `[Security] Avertissement : Le mode de ${path.basename(filePath)} est 0${mode.toString(8)}, attendu 0600.`
                );
            }
        } else {
            try {
                fs.chmodSync(filePath, 0o600);
            } catch (_) {}
            try {
                let username = process.env.USERNAME || process.env.USER;
                if (!username) {
                    try {
                        username = os.userInfo().username;
                    } catch (_) {}
                }
                if (username) {
                    execFileSync("icacls", [filePath, "/inheritance:r", "/grant:r", `${username}:(R,W)`], {
                        stdio: "ignore",
                        windowsHide: true,
                        timeout: 3000
                    });
                }
            } catch (_) {}
        }
        return true;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Security] Erreur lors du renforcement des permissions sur ${filePath}: ${msg}`);
        return false;
    }
}

export function getSecretKey(): Buffer {
    let secret = process.env.APP_SECRET;
    if (!secret || secret.trim() === "") {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
        }
        if (fs.existsSync(SECRET_FILE)) {
            secureFilePermissions(SECRET_FILE);
            secret = fs.readFileSync(SECRET_FILE, "utf8").trim();
        } else {
            secret = crypto.randomBytes(32).toString("hex");
            try {
                fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600, encoding: "utf8" });
                secureFilePermissions(SECRET_FILE);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn("[Crypto] Impossible de sauvegarder .app_secret, utilisation d'une clé volatile:", msg);
            }
        }
    }
    return crypto.createHash("sha256").update(secret).digest();
}

let cachedSecretKey: Buffer | null = null;
function getKey(): Buffer {
    if (!cachedSecretKey) {
        cachedSecretKey = getSecretKey();
    }
    return cachedSecretKey;
}

export function hashPassword(password: string): string {
    if (!password || typeof password !== "string") {
        throw new Error("Mot de passe invalide pour le hachage.");
    }
    const salt = crypto.randomBytes(16).toString("hex");
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return `${salt}:${derivedKey.toString("hex")}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
    if (!password || !storedHash || typeof storedHash !== "string") {
        return false;
    }
    const parts = storedHash.split(":");
    if (parts.length !== 2) return false;
    const [salt, keyHex] = parts;
    const keyBuf = Buffer.from(keyHex, "hex");
    const derivedKey = crypto.scryptSync(password, salt, keyBuf.length);
    if (derivedKey.length !== keyBuf.length) return false;
    return crypto.timingSafeEqual(derivedKey, keyBuf);
}

export function encryptConfig(configObj: unknown): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
    const jsonStr = JSON.stringify(configObj);
    let encrypted = cipher.update(jsonStr, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptConfig<T = unknown>(encryptedStr: string): T {
    if (!encryptedStr || typeof encryptedStr !== "string") {
        throw new Error("Donnée chiffrée manquante ou invalide.");
    }
    const parts = encryptedStr.split(":");
    if (parts.length !== 3) {
        throw new Error("Format de configuration chiffrée corrompu.");
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted) as T;
}
