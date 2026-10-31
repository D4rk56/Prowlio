"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    checkRealDebridKey,
    checkInstantRealDebrid,
    isRealDebridTargetDead,
    markRealDebridTargetDead,
    selectRealDebridFiles
} = require("../lib/realdebrid");

const {
    checkDebridLinkKey,
    checkInstantDebridLink,
    isDebridLinkTargetDead,
    markDebridLinkTargetDead
} = require("../lib/debridlink");

const { checkJackettConnectivity, searchJackettOnDemand } = require("../lib/jackett");

const { formatAioStream } = require("../lib/helpers");
const { resolveUserApiKey, resolveUserConfig } = require("../lib/resolver");
const { createUser, deleteUser } = require("../lib/db");
const { hashPassword, encryptConfig } = require("../lib/crypto");

// =============================================================================
// 1. TESTS REAL-DEBRID
// =============================================================================

test("Real-Debrid - checkRealDebridKey rejects empty or whitespace key", async () => {
    const r1 = await checkRealDebridKey("");
    assert.equal(r1.valid, false);
    assert.ok(r1.error);

    const r2 = await checkRealDebridKey("   ");
    assert.equal(r2.valid, false);
});

test("Real-Debrid - dead target quarantine mutes recurring failures for 30 minutes", () => {
    const hash = "1234567890abcdef1234567890abcdef12345678";
    assert.equal(isRealDebridTargetDead(hash), false);

    markRealDebridTargetDead(hash);
    assert.equal(isRealDebridTargetDead(hash), true);
    assert.equal(isRealDebridTargetDead(hash.toUpperCase()), true);
});

test("Real-Debrid - selectRealDebridFiles handles missing arguments gracefully", async () => {
    const res = await selectRealDebridFiles("", [], "");
    assert.equal(res, false);
});

test("Real-Debrid - checkInstantRealDebrid returns empty map on empty input", async () => {
    const res = await checkInstantRealDebrid([], "fake_key");
    assert.deepEqual(res, {});
});

// =============================================================================
// 2. TESTS DEBRID-LINK
// =============================================================================

test("Debrid-Link - checkDebridLinkKey rejects empty key", async () => {
    const r = await checkDebridLinkKey("");
    assert.equal(r.valid, false);
    assert.ok(r.error);
});

test("Debrid-Link - dead target quarantine mutes recurring failures", () => {
    const hash = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
    assert.equal(isDebridLinkTargetDead(hash), false);

    markDebridLinkTargetDead(hash);
    assert.equal(isDebridLinkTargetDead(hash), true);
});

test("Debrid-Link - checkInstantDebridLink returns empty map on empty input", async () => {
    const res = await checkInstantDebridLink([], "fake_key");
    assert.deepEqual(res, {});
});

// =============================================================================
// 3. TESTS JACKETT (TORZNAB)
// =============================================================================

test("Jackett - checkJackettConnectivity rejects missing parameters", async () => {
    const r1 = await checkJackettConnectivity("", "key");
    assert.equal(r1.valid, false);

    const r2 = await checkJackettConnectivity("http://192.168.1.50:9117", "");
    assert.equal(r2.valid, false);
});

test("Jackett - searchJackettOnDemand returns empty array when unconfigured", async () => {
    const res = await searchJackettOnDemand({ cleanTitle: "Gladiator", jackettUrl: "", jackettKey: "" });
    assert.deepEqual(res, []);
});

// =============================================================================
// 5. TESTS STREAM FORMATTING WITH RD & DL
// =============================================================================

test("formatAioStream - supports Real-Debrid and Debrid-Link status tags", () => {
    const streamRd = formatAioStream({
        filename: "Dune.Part.Two.2024.1080p.WEB-DL.mkv",
        sizeBytes: 4_000_000_000,
        isInstant: true,
        debridProvider: "realdebrid",
        url: "https://example.com/stream"
    });
    assert.ok(streamRd.name.includes("[RD+]"));
    assert.ok(streamRd.title.includes("⚡ IMMÉDIAT"));

    const streamDl = formatAioStream({
        filename: "Furiosa.2024.1080p.mkv",
        sizeBytes: 3_500_000_000,
        isInstant: true,
        debridProvider: "debridlink",
        url: "https://example.com/stream"
    });
    assert.ok(streamDl.name.includes("[DL+]"));
    assert.ok(streamDl.title.includes("⚡ IMMÉDIAT"));
});

// =============================================================================
// 6. TESTS USER API RESOLUTION & FAILOVER PREPARATION
// =============================================================================

test("Resolver - resolveUserApiKey picks active key for Real-Debrid and Debrid-Link accounts", () => {
    const testUuidRd = "22222222-3333-4444-5555-666666666666";
    const testUuidDl = "33333333-4444-5555-6666-777777777777";
    const passwordHash = hashPassword("pass123");

    try {
        createUser(
            testUuidRd,
            passwordHash,
            encryptConfig({
                debridProvider: "realdebrid",
                realdebridApiKey: "rd_secret_token_123"
            })
        );

        createUser(
            testUuidDl,
            passwordHash,
            encryptConfig({
                debridProvider: "debridlink",
                debridlinkApiKey: "dl_secret_token_456"
            })
        );

        const keyRd = resolveUserApiKey(testUuidRd);
        assert.equal(keyRd, "rd_secret_token_123");

        const cfgRd = resolveUserConfig(testUuidRd);
        assert.equal(cfgRd.debridProvider, "realdebrid");
        assert.equal(cfgRd.realdebridApiKey, "rd_secret_token_123");

        const keyDl = resolveUserApiKey(testUuidDl);
        assert.equal(keyDl, "dl_secret_token_456");

        const cfgDl = resolveUserConfig(testUuidDl);
        assert.equal(cfgDl.debridProvider, "debridlink");
        assert.equal(cfgDl.debridlinkApiKey, "dl_secret_token_456");
    } finally {
        deleteUser(testUuidRd);
        deleteUser(testUuidDl);
    }
});
