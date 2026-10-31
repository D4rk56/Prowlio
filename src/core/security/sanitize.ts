const ALLOWED_TAGS = new Set([
    "p",
    "div",
    "span",
    "br",
    "hr",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "small",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "figure",
    "figcaption",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "a",
    "img"
]);

const VOID_TAGS = new Set(["br", "hr", "img"]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
    a: new Set(["href", "title"]),
    img: new Set(["src", "alt", "title", "width", "height", "loading"])
};

const URL_ATTRS: Record<string, string> = { a: "href", img: "src" };

const DISCORD_HOSTS = new Set(["discord.gg", "discord.com", "www.discord.com"]);

const NAMED_ENTITIES: Record<string, string> = {
    "&colon;": ":",
    "&tab;": "\t",
    "&newline;": "\n",
    "&sol;": "/",
    "&num;": "#",
    "&period;": ".",
    "&commat;": "@",
    "&percnt;": "%",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'"
};

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9:_.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;

export function escapeHtml(value: unknown): string {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function decodeEntities(value: unknown): string {
    return String(value)
        .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
        })
        .replace(/&#(\d+);?/g, (_, dec) => {
            const code = parseInt(dec, 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
        })
        .replace(/&[a-zA-Z]+;/g, m => {
            const decoded = NAMED_ENTITIES[m.toLowerCase()];
            return decoded !== undefined ? decoded : "";
        });
}

export function normalizeUrlForCheck(raw: unknown): string {
    return decodeEntities(raw).replace(/[\u0000-\u0020\u007f]/g, "");
}

export function isSafeLinkHref(raw: unknown): boolean {
    const value = normalizeUrlForCheck(raw);
    if (!value) return false;
    if (value.startsWith("#") || value.startsWith("/")) return true;
    return /^https?:\/\//i.test(value) || /^mailto:[^\s]+$/i.test(value);
}

export function isSafeImageSrc(raw: unknown): boolean {
    const value = normalizeUrlForCheck(raw);
    if (!value) return false;
    if (value.startsWith("/")) return true;
    return /^https?:\/\//i.test(value);
}

export function sanitizeAttributes(tagName: string, rawAttrs: string): string {
    const allowed = ALLOWED_ATTRS[tagName];
    if (!allowed) return "";

    const urlAttr = URL_ATTRS[tagName];
    const out: string[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;

    ATTR_RE.lastIndex = 0;
    while ((match = ATTR_RE.exec(rawAttrs)) !== null) {
        const name = match[1].toLowerCase();
        const rawValue = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4];

        if (!allowed.has(name) || seen.has(name)) continue;

        if (rawValue === undefined) {
            if (name === "loading") {
                seen.add(name);
                out.push('loading="lazy"');
            }
            continue;
        }

        if (name === urlAttr) {
            const ok = tagName === "a" ? isSafeLinkHref(rawValue) : isSafeImageSrc(rawValue);
            if (!ok) continue;
        }

        if (name === "width" || name === "height") {
            if (!/^\d{1,4}$/.test(String(rawValue).trim())) continue;
        }

        seen.add(name);
        out.push(`${name}="${escapeHtml(decodeEntities(rawValue).replace(/[\u0000-\u001f\u007f]/g, ""))}"`);
    }

    if (tagName === "img" && !seen.has("loading")) out.push('loading="lazy"');
    if (tagName === "a") out.push('target="_blank"', 'rel="noopener noreferrer nofollow"');

    return out.length > 0 ? " " + out.join(" ") : "";
}

export function sanitizeEmbedHtml(input: unknown, options: { maxLength?: number } = {}): string {
    const maxLength = Number.isFinite(options.maxLength) ? Number(options.maxLength) : 4000;
    if (input === undefined || input === null) return "";

    let source = String(input)
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<![^>]*>/g, "")
        .replace(/<\?[\s\S]*?\?>/g, "");

    if (source.length > maxLength) source = source.slice(0, maxLength);

    const openStack: string[] = [];
    let out = "";
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    TAG_RE.lastIndex = 0;
    while ((match = TAG_RE.exec(source)) !== null) {
        if (match.index > lastIndex) out += escapeHtml(source.slice(lastIndex, match.index));
        lastIndex = TAG_RE.lastIndex;

        const rawTag = match[0];
        const tagName = match[1].toLowerCase();
        const rawAttrs = match[2] || "";
        const selfClosing = match[3] === "/";
        const isClosing = rawTag.startsWith("</");

        if (!ALLOWED_TAGS.has(tagName)) continue;

        if (isClosing) {
            const index = openStack.lastIndexOf(tagName);
            if (index !== -1) {
                for (let i = openStack.length - 1; i >= index; i--) out += `</${openStack[i]}>`;
                openStack.length = index;
            }
            continue;
        }

        out += `<${tagName}${sanitizeAttributes(tagName, rawAttrs)}>`;
        if (!VOID_TAGS.has(tagName) && !selfClosing) openStack.push(tagName);
    }

    if (lastIndex < source.length) out += escapeHtml(source.slice(lastIndex));

    for (let i = openStack.length - 1; i >= 0; i--) out += `</${openStack[i]}>`;

    return out;
}

export function isSafeEmbedUrl(raw: unknown): boolean {
    if (!raw || typeof raw !== "string") return false;
    const value = raw.trim();
    if (!value || value.length > 500) return false;
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return false;
    }
    return parsed.protocol === "https:";
}

export function isSafeDiscordUrl(raw: unknown): boolean {
    if (!raw || typeof raw !== "string") return false;
    const value = raw.trim();
    if (!value || value.length > 200) return false;
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return false;
    }
    return parsed.protocol === "https:" && DISCORD_HOSTS.has(parsed.hostname.toLowerCase());
}

export function normalizeSiteSettings(body: Record<string, unknown> = {}): Record<string, unknown> {
    const out = { ...body };

    if (out.embedHtml !== undefined) {
        out.embedHtml = sanitizeEmbedHtml(out.embedHtml);
    }
    if (out.embedIframeUrl !== undefined) {
        out.embedIframeUrl = isSafeEmbedUrl(out.embedIframeUrl) ? String(out.embedIframeUrl).trim() : "";
    }
    if (out.embedIframeHeight !== undefined) {
        const h = Number(out.embedIframeHeight);
        out.embedIframeHeight = Number.isInteger(h) && h >= 80 && h <= 1200 ? h : 300;
    }
    if (out.discordUrl !== undefined) {
        out.discordUrl = isSafeDiscordUrl(out.discordUrl) ? String(out.discordUrl).trim() : "";
    }
    return out;
}
