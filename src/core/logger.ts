import { AsyncLocalStorage } from "node:async_hooks";

export interface LogEntry {
    id: number;
    timestamp: string;
    level: string;
    module: string;
    user: string;
    message: string;
}

const MAX_LOGS = 600;
const logBuffer: LogEntry[] = [];
let nextLogId = 1;
const requestContext = new AsyncLocalStorage<{ user: unknown }>();

export function runWithUser<T>(userIdentifier: unknown, fn: () => T): T {
    return requestContext.run({ user: userIdentifier || "" }, fn);
}

export function getCurrentUser(): unknown {
    const store = requestContext.getStore();
    return (store && store.user) || "";
}

export function formatUserIdentifier(user: unknown): string {
    if (!user) return "";
    if (typeof user === "string") return user;
    if (typeof user === "object" && user !== null) {
        const u = user as Record<string, unknown>;
        const pseudo = typeof u.pseudo === "string" ? u.pseudo.trim() : "";
        const shortUuid = typeof u.uuid === "string" ? u.uuid.slice(0, 8) : "";
        if (pseudo && shortUuid) return `${pseudo} (${shortUuid})`;
        if (pseudo) return pseudo;
        if (shortUuid) return shortUuid;
        return JSON.stringify(user);
    }
    return String(user);
}

export function addLog(level: string, moduleName: string, message: unknown, user: unknown = null): LogEntry {
    const activeUser = user !== null ? user : getCurrentUser();
    const entry: LogEntry = {
        id: nextLogId++,
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        module: moduleName || "System",
        user: formatUserIdentifier(activeUser),
        message: typeof message === "string" ? message : JSON.stringify(message)
    };

    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOGS) {
        logBuffer.shift();
    }
    return entry;
}

const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

function parseConsolePrefix(args: unknown[]): { module: string; msg: string } {
    if (!args || args.length === 0) return { module: "App", msg: "" };
    const first = String(args[0]);
    const moduleMatch = first.match(/^\[(.*?)\]\s*(.*)$/);
    if (moduleMatch) {
        const mod = moduleMatch[1];
        const rest = [moduleMatch[2], ...args.slice(1)].filter(Boolean).join(" ");
        return { module: mod, msg: rest };
    }
    return { module: "App", msg: args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ") };
}

let interceptorsInitialized = false;
export function initConsoleInterceptors(): void {
    if (interceptorsInitialized) return;
    interceptorsInitialized = true;

    console.log = function (...args: unknown[]) {
        originalConsoleLog.apply(console, args);
        const { module, msg } = parseConsolePrefix(args);
        addLog("INFO", module, msg);
    };

    console.info = function (...args: unknown[]) {
        originalConsoleInfo.apply(console, args);
        const { module, msg } = parseConsolePrefix(args);
        addLog("INFO", module, msg);
    };

    console.warn = function (...args: unknown[]) {
        originalConsoleWarn.apply(console, args);
        const { module, msg } = parseConsolePrefix(args);
        addLog("WARN", module, msg);
    };

    console.error = function (...args: unknown[]) {
        originalConsoleError.apply(console, args);
        const { module, msg } = parseConsolePrefix(args);
        addLog("ERROR", module, msg);
    };
}

export interface GetLogsOptions {
    level?: string;
    limit?: number;
    search?: string;
    sinceId?: number;
    user?: string;
}

export function getLogs({
    level = "ALL",
    limit = 150,
    search = "",
    sinceId = 0,
    user = ""
}: GetLogsOptions = {}): LogEntry[] {
    let filtered = logBuffer;

    if (sinceId && !isNaN(sinceId) && sinceId > 0) {
        filtered = filtered.filter(l => l.id > sinceId);
    }

    if (level && level !== "ALL") {
        const lvl = level.toUpperCase();
        filtered = filtered.filter(l => l.level === lvl);
    }

    if (user && user.trim() !== "") {
        const u = user.toLowerCase();
        filtered = filtered.filter(l => l.user && l.user.toLowerCase().includes(u));
    }

    if (search && search.trim() !== "") {
        const q = search.toLowerCase();
        filtered = filtered.filter(
            l =>
                l.message.toLowerCase().includes(q) ||
                l.module.toLowerCase().includes(q) ||
                (l.user && l.user.toLowerCase().includes(q))
        );
    }

    const lim = Math.min(Math.max(Number(limit) || 150, 1), 600);
    return filtered.slice(-lim);
}

export function clearLogs(): boolean {
    logBuffer.length = 0;
    return true;
}

export const logger = {
    info: (mod: string, msg?: unknown) => (msg !== undefined ? addLog("INFO", mod, msg) : addLog("INFO", "App", mod)),
    warn: (mod: string, msg?: unknown) => (msg !== undefined ? addLog("WARN", mod, msg) : addLog("WARN", "App", mod)),
    error: (mod: string, msg?: unknown) =>
        msg !== undefined ? addLog("ERROR", mod, msg) : addLog("ERROR", "App", mod),
    debug: (mod: string, msg?: unknown) =>
        msg !== undefined ? addLog("DEBUG", mod, msg) : addLog("DEBUG", "App", mod),
    getLogs,
    clearLogs,
    addLog
};
