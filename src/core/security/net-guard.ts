import net from "node:net";
import { promises as dns } from "node:dns";

export function ipv4ToInt(ip: string): number | null {
    const parts = ip.split(".").map(n => parseInt(n, 10));
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export function isPrivateIpv4(ip: string): boolean {
    const intVal = ipv4ToInt(ip);
    if (intVal === null) return true;
    const ranges: [number, number][] = [
        [0x00000000, 0x00ffffff], // 0.0.0.0/8
        [0x0a000000, 0x0affffff], // 10.0.0.0/8
        [0x64400000, 0x647fffff], // 100.64.0.0/10
        [0x7f000000, 0x7fffffff], // 127.0.0.0/8
        [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16
        [0xac100000, 0xac1fffff], // 172.16.0.0/12
        [0xc0000000, 0xc00000ff], // 192.0.0.0/24
        [0xc0000200, 0xc00002ff], // 192.0.2.0/24
        [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
        [0xc6120000, 0xc613ffff], // 198.18.0.0/15
        [0xc6336400, 0xc63364ff], // 198.51.100.0/24
        [0xcb007100, 0xcb0071ff], // 203.0.113.0/24
        [0xe0000000, 0xefffffff], // 224.0.0.0/4
        [0xf0000000, 0xffffffff] // 240.0.0.0/4
    ];
    return ranges.some(([lo, hi]) => intVal >= lo && intVal <= hi);
}

export function expandIpv6(addr: string): number[] | null {
    let a = addr.toLowerCase().replace(/^\[|\]$/g, "");
    let v4: string | null = null;
    const v4Match = a.match(/^(.*):(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (v4Match) {
        a = v4Match[1];
        v4 = v4Match[2];
    }
    const halves = a.split("::");
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves[1] ? halves[1].split(":") : [];
    let groups: string[];
    if (halves.length === 2) {
        const missing = 8 - head.length - tail.length - (v4 ? 1 : 0);
        if (missing < 0) return null;
        groups = head.concat(new Array(missing).fill("0"), tail);
    } else {
        groups = head;
    }
    if (v4) {
        const intVal = ipv4ToInt(v4);
        if (intVal === null) return null;
        groups = groups.concat([((intVal >>> 16) & 0xffff).toString(16), (intVal & 0xffff).toString(16)]);
    }
    return groups.map(g => parseInt(g || "0", 16));
}

export function ipv6ToBigInt(addr: string): bigint | null {
    const groups = expandIpv6(addr);
    if (!groups || groups.length !== 8) return null;
    let big = 0n;
    for (const g of groups) {
        if (!Number.isInteger(g) || g < 0 || g > 0xffff) return null;
        big = (big << 16n) | BigInt(g);
    }
    return big;
}

export function isPrivateIpv6(ip: string): boolean {
    const big = ipv6ToBigInt(ip);
    if (big === null) return true;
    const fc00 = 0xfc000000000000000000000000000000n;
    const fe80 = 0xfe800000000000000000000000000000n;
    if (big === 0n) return true;
    if (big === 1n) return true;
    if ((big & 0xfe000000000000000000000000000000n) === fc00) return true;
    if ((big & 0xffc00000000000000000000000000000n) === fe80) return true;
    return false;
}

export function isPrivateIp(ip: string): boolean {
    if (!ip || typeof ip !== "string") return true;
    const version = net.isIP(ip);
    if (version === 4) return isPrivateIpv4(ip);
    if (version === 6) return isPrivateIpv6(ip);
    return true;
}

export function coerceNumericHost(hostname: string): string | null {
    if (/^\d+$/.test(hostname)) {
        const n = Number(hostname);
        if (Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff) {
            const intVal = n >>> 0;
            return [(intVal >>> 24) & 0xff, (intVal >>> 16) & 0xff, (intVal >>> 8) & 0xff, intVal & 0xff].join(".");
        }
    }
    if (/^0x[0-9a-f]+$/i.test(hostname)) {
        const n = Number.parseInt(hostname.slice(2), 16);
        if (Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff) {
            const intVal = n >>> 0;
            return [(intVal >>> 24) & 0xff, (intVal >>> 16) & 0xff, (intVal >>> 8) & 0xff, intVal & 0xff].join(".");
        }
    }
    return null;
}

export function isPrivateHost(hostname: string): boolean {
    if (!hostname || typeof hostname !== "string") return true;
    let h = hostname
        .toLowerCase()
        .trim()
        .replace(/^\[|\]$/g, "")
        .replace(/\.$/, "");
    if (!h) return true;

    if (h === "localhost" || h.endsWith(".localhost")) return true;

    const coerced = coerceNumericHost(h);
    if (coerced) return isPrivateIpv4(coerced);

    if (net.isIP(h) !== 0) return isPrivateIp(h);
    return false;
}

export function isPrivateUrl(urlStr: string): boolean {
    if (!urlStr || typeof urlStr !== "string") return true;
    let s = urlStr.trim();
    if (!s) return true;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = `http://${s}`;
    try {
        return isPrivateHost(new URL(s).hostname);
    } catch {
        return true;
    }
}

export function isForbiddenTargetIpv4(ip: string): boolean {
    const intVal = ipv4ToInt(ip);
    if (intVal === null) return true;
    const ranges: [number, number][] = [
        [0x00000000, 0x00ffffff],
        [0xa9fe0000, 0xa9feffff],
        [0xc0000000, 0xc00000ff],
        [0xc0000200, 0xc00002ff],
        [0xc6120000, 0xc613ffff],
        [0xc6336400, 0xc63364ff],
        [0xcb007100, 0xcb0071ff],
        [0xe0000000, 0xefffffff],
        [0xf0000000, 0xffffffff]
    ];
    return ranges.some(([lo, hi]) => intVal >= lo && intVal <= hi);
}

export function isForbiddenTargetIpv6(ip: string): boolean {
    const big = ipv6ToBigInt(ip);
    if (big === null) return true;
    if (big === 0n) return true;
    const fe80 = 0xfe800000000000000000000000000000n;
    if ((big & 0xffc00000000000000000000000000000n) === fe80) return true;
    const ff00 = 0xff000000000000000000000000000000n;
    if ((big & 0xff000000000000000000000000000000n) === ff00) return true;
    return false;
}

export function isForbiddenTargetIp(ip: string): boolean {
    if (!ip || typeof ip !== "string") return true;
    const version = net.isIP(ip);
    if (version === 4) return isForbiddenTargetIpv4(ip);
    if (version === 6) return isForbiddenTargetIpv6(ip);
    return true;
}

export function isForbiddenTargetHost(hostname: string): boolean {
    if (!hostname || typeof hostname !== "string") return true;
    const h = hostname
        .toLowerCase()
        .trim()
        .replace(/^\[|\]$/g, "")
        .replace(/\.$/, "");
    if (!h) return true;
    const coerced = coerceNumericHost(h);
    if (coerced) return isForbiddenTargetIpv4(coerced);
    if (net.isIP(h) !== 0) return isForbiddenTargetIp(h);
    return false;
}

export function isForbiddenTargetUrl(urlStr: string): boolean {
    if (!urlStr || typeof urlStr !== "string") return true;
    let s = urlStr.trim();
    if (!s) return true;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = `http://${s}`;
    try {
        return isForbiddenTargetHost(new URL(s).hostname);
    } catch {
        return true;
    }
}

export async function assertSafeSelfHostedUrl(urlStr: string): Promise<{ ok: boolean; error?: string }> {
    if (!urlStr || typeof urlStr !== "string") {
        return { ok: false, error: "URL requise." };
    }
    let parsed: URL;
    try {
        parsed = new URL(urlStr.trim());
    } catch {
        return { ok: false, error: "URL invalide." };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "Protocole non autorisé (http/https uniquement)." };
    }

    const hostname = parsed.hostname;
    if (isForbiddenTargetHost(hostname)) {
        return { ok: false, error: "Hôte non autorisé (link-local / métadonnées / réservé)." };
    }

    try {
        const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
        if (Array.isArray(addresses)) {
            for (const entry of addresses) {
                if (entry && isForbiddenTargetIp(entry.address)) {
                    return {
                        ok: false,
                        error: "L'hôte résout vers une adresse interdite (link-local / métadonnées / réservé)."
                    };
                }
            }
        }
    } catch {
        // DNS indisponible / hôte introuvable → laisser la requête échouer naturellement.
    }

    return { ok: true };
}

export async function assertSafePublicUrl(urlStr: string): Promise<{ ok: boolean; error?: string }> {
    if (!urlStr || typeof urlStr !== "string") {
        return { ok: false, error: "URL requise." };
    }
    let parsed: URL;
    try {
        parsed = new URL(urlStr.trim());
    } catch {
        return { ok: false, error: "URL invalide." };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "Protocole non autorisé (http/https uniquement)." };
    }

    const hostname = parsed.hostname;
    if (isPrivateHost(hostname)) {
        return { ok: false, error: "Hôte privé ou réservé non autorisé." };
    }

    try {
        const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
        if (Array.isArray(addresses)) {
            for (const entry of addresses) {
                if (entry && isPrivateIp(entry.address)) {
                    return { ok: false, error: "L'hôte résout vers une adresse privée non autorisée." };
                }
            }
        }
    } catch {
        // DNS indisponible / hôte introuvable
    }

    return { ok: true };
}
