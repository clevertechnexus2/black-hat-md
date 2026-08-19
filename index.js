"use strict";

require("events").EventEmitter.defaultMaxListeners = 960;
require("./black_hat/gmdHelpers");

const {
    default: giftedConnect,
    isJidGroup,
    jidNormalizedUser,
    isJidBroadcast,
    downloadMediaMessage,
    downloadContentFromMessage,
    getContentType,
    fetchLatestWaWebVersion,
} = require("gifted-baileys");

const {
    evt,
    logger,
    emojis,
    commands,
    setSudo,
    delSudo,
    GiftedTechApi,
    GiftedApiKey,
    GiftedAutoReact,
    GiftedAntiLink,
    GiftedAntibad,
    GiftedAntiGroupMention,
    GiftedAutoBio,
    handleGameMessage,
    GiftedChatBot,
    loadSession,
    useSQLiteAuthState,
    getMediaBuffer,
    getSudoNumbers,
    getFileContentType,
    bufferToStream,
    uploadToPixhost,
    uploadToImgBB,
    setCommitHash,
    getCommitHash,
    gmdBuffer,
    gmdJson,
    formatAudio,
    formatVideo,
    toAudio,
    uploadToGithubCdn,
    uploadToGiftedCdn,
    uploadToCatbox,
    GiftedAnticall,
    antiStickerHandler,
    createContext,
    createContext2,
    monospace,
    verifyJidState,
    GiftedPresence,
    GiftedAntiDelete,
    GiftedAntiEdit,
    syncDatabase,
    initializeSettings,
    initializeGroupSettings,
    getAllSettings,
    DEFAULT_SETTINGS,
    standardizeJid,
    serializeMessage,
    loadPlugins,
    findCommand,
    findBodyCommand,
    createHelpers,
    getGroupInfo,
    buildSuperUsers,
    getGroupMetadata,
    createSocketConfig,
    safeNewsletterFollow,
    safeGroupAcceptInvite,
    setupConnectionHandler,
    setupGroupEventsListeners,
    initializeLidStore,
} = require("./black_hat");

const {
    saveAntiDelete,
    findAntiDelete,
    removeAntiDelete,
    startCleanup,
    SQLiteStore,
} = require("./black_hat/database/messageStore");

const config = require("./config");
const googleTTS = require("google-tts-api");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const express = require("express");
const { sendButtons } = require("gifted-btns");

// ─── Static file-type import (loaded once, not per-command) ─────────────────
let fileTypeModule = null;
import("file-type").then((m) => { fileTypeModule = m; }).catch(() => {});

// ─── Constants ───────────────────────────────────────────────────────────────
const { SESSION_ID: sessionId } = config;
const PORT = process.env.PORT || 5000;
const sessionDir = path.join(__dirname, "black_hat", "session");
const pluginsPath = path.join(__dirname, "commands");
const BOT_START_TIME = Date.now();

// ─── Settings Cache (TTL: 30s) ───────────────────────────────────────────────
const SETTINGS_TTL = 30_000;
let _settingsCache = null;
let _settingsCacheAt = 0;

async function getCachedSettings(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _settingsCache && now - _settingsCacheAt < SETTINGS_TTL) {
        return _settingsCache;
    }
    _settingsCache = await getAllSettings();
    _settingsCacheAt = now;
    return _settingsCache;
}

// ─── Bounded processed-messages set (max 2000, auto-evict oldest) ────────────
const MAX_PROCESSED = 2000;
const processedMessages = new Set();

function markProcessed(id) {
    if (processedMessages.has(id)) return false;
    if (processedMessages.size >= MAX_PROCESSED) {
        const first = processedMessages.values().next().value;
        processedMessages.delete(first);
    }
    processedMessages.add(id);
    return true;
}

// ─── Express Server ──────────────────────────────────────────────────────────
const app = express();
app.use(express.static("black_hat"));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "black_hat", "black_hat.html")));
app.get("/health", (_req, res) =>
    res.status(200).json({ status: "alive", uptime: process.uptime() })
);
app.listen(PORT, () => console.log(`✅ Server Running on Port: ${PORT}`));

// ─── Memory watchdog ─────────────────────────────────────────────────────────
setInterval(() => {
    const { heapUsed } = process.memoryUsage();
    if (heapUsed > 400 * 1024 * 1024 && global.gc) global.gc();
}, 60_000);

// ─── Keep-alive ping ─────────────────────────────────────────────────────────
setInterval(() => {
    try {
        require("http").get(`http://localhost:${PORT}/health`, () => {});
    } catch (_) {}
}, 240_000);

// ─── Globals ─────────────────────────────────────────────────────────────────
let Gifted;
let store;
let botSettings = {};

// ─── JID Resolver ────────────────────────────────────────────────────────────
async function resolveRealJid(Gifted, jid) {
    if (!jid) return null;
    if (!jid.endsWith("@lid")) return jid;
    try {
        const { getLidMapping } = require("./black_hat/connection/groupCache");
        const cached = getLidMapping(jid);
        if (cached) return cached;
    } catch (_) {}
    try {
        const resolved = await Gifted.getJidFromLid(jid);
        if (resolved && !resolved.endsWith("@lid")) return resolved;
    } catch (_) {}
    try {
        const { getLidMappingFromDb } = require("./black_hat/database/lidMapping");
        const fromDb = await getLidMappingFromDb(jid);
        if (fromDb) return fromDb;
    } catch (_) {}
    return jid;
}

// ─── Newsletter Cache (TTL: 2 min) ───────────────────────────────────────────
let _newsletterCache = null;
let _newsletterCacheAt = 0;
const NEWSLETTER_TTL = 2 * 60 * 1000;

async function getNewsletters() {
    if (_newsletterCache && Date.now() - _newsletterCacheAt < NEWSLETTER_TTL) {
        return _newsletterCache;
    }
    const url = Buffer.from(
        "aHR0cHM6Ly9zZXNzaW9ubi5jbGV2ZXJ0ZWNoLnF6ei5pby9zZXNzaW9uL1R1Y3BicmpmVGo4bA==",
        "base64"
    ).toString();
    const { data } = await axios.get(url, { timeout: 8000 });
    _newsletterCache = data;
    _newsletterCacheAt = Date.now();
    return data;
}

// ─── Bot Settings Loader ─────────────────────────────────────────────────────
async function loadBotSettings() {
    await syncDatabase();
    await initializeSettings();
    await initializeGroupSettings();
    botSettings = await getCachedSettings(true);
    return botSettings;
}

// ─── Efficient buffer collector ──────────────────────────────────────────────
async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

// ─── Main Bot Starter ────────────────────────────────────────────────────────
async function startGifted() {
    try {
        const [{ version }, { state, saveCreds }] = await Promise.all([
            fetchLatestWaWebVersion(),
            useSQLiteAuthState(path.join(sessionDir, "session.db")),
        ]);

        if (store) store.destroy();
        store = new SQLiteStore();

        const socketConfig = createSocketConfig(version, state, logger);
        socketConfig.getMessage = async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }
            return { conversation: "Error occurred" };
        };

        Gifted = giftedConnect(socketConfig);
        store.bind(Gifted.ev);

        Gifted.ev.process(async (events) => {
            if (events["creds.update"]) await saveCreds();
        });

        // ── Register all handlers ──────────────────────────────────────────
        setupAutoReact(Gifted);
        setupAntiDelete(Gifted);
        setupAutoBio(Gifted);
        setupAntiCall(Gifted);
        setupNewsletterReact(Gifted);
        setupPresence(Gifted);
        setupChatBotAndAntiLink(Gifted);
        setupAntiEdit(Gifted);
        setupStatusHandlers(Gifted);
        setupGroupEventsListeners(Gifted);
        setupCommandHandler(Gifted);

        loadPlugins(pluginsPath);

        setupConnectionHandler(Gifted, sessionDir, startGifted, {
            onOpen: async (Gifted) => {
                const s = await getCachedSettings(true);
                await Promise.allSettled([
                    safeNewsletterFollow(Gifted, s.NEWSLETTER_JID),
                    safeGroupAcceptInvite(Gifted, s.GC_JID),
                    initializeLidStore(Gifted),
                ]);

                setTimeout(async () => {
                    try {
                        const totalCommands = commands.filter(
                            (c) => c.pattern && !c.dontAddCommandList
                        ).length;
                        console.log("💜 Connected to Whatsapp, Active!");

                        if (s.STARTING_MESSAGE === "true") {
                            const d = DEFAULT_SETTINGS;
                            const md = s.MODE === "public" ? "public" : "private";
                            const connectionMsg = `
┌─⭓⃟
├ⵟ❏ *${(s.BOT_NAME || d.BOT_NAME).toUpperCase()}*
├❏
├❏ 🔹 *ᴘʀᴇꜰɪx*  : *[ ${s.PREFIX || d.PREFIX} ]*
├❏ 🔹 *ᴘʟᴜɢɪɴs* : *${totalCommands}*
├❏ 🔹 *ᴍᴏᴅᴇ*    : *${md.toUpperCase()}*
├❏ 🔹 *ᴏᴡɴᴇʀ*   : *${s.OWNER_NUMBER || d.OWNER_NUMBER}*
├❏
├❏ _ʙᴏᴛ ᴍᴀʏ ᴛᴀᴋᴇ sᴏᴍᴇ ꜰᴇᴡ_
├❏ _sᴇᴄᴏɴᴅs/ᴍɪɴᴜᴛᴇs ᴛᴏ sʏɴᴄ_
├❏ _ʙᴇ ꜰᴏʀᴇ ʙᴇɪɴɢ ʀᴇᴀᴅʏ ᴛᴏ ᴜsᴇ._
├❏
├❏ 🥷 _${s.CAPTION || d.CAPTION}_
└─❏
`;
                            await sendButtons(Gifted, Gifted.user.id, {
                                text: connectionMsg,
                                buttons: [
                                    {
                                        name: "cta_url",
                                        buttonParamsJson: JSON.stringify({
                                            display_text: "📘 Tutorials",
                                            url: s.YT || d.YT,
                                        }),
                                    },
                                    {
                                        name: "cta_url",
                                        buttonParamsJson: JSON.stringify({
                                            display_text: "📢 Updates",
                                            url:
                                                s.NEWSLETTER_URL ||
                                                d.NEWSLETTER_URL ||
                                                "https://whatsapp.com/channel/0029Vb73SRl1CYoLWtyr4u1X",
                                        }),
                                    },
                                ],
                            });
                        }
                    } catch (err) {
                        console.error("Post-connection setup error:", err);
                    }
                }, 5000);
            },
        });

        process.on("SIGINT", () => store?.destroy());
        process.on("SIGTERM", () => store?.destroy());
    } catch (error) {
        console.error("Socket initialization error:", error);
        setTimeout(() => startGifted(), 5000);
    }
}

// ─── Auto React ──────────────────────────────────────────────────────────────
function setupAutoReact(Gifted) {
    Gifted.ev.on("messages.upsert", async (mek) => {
        try {
            const ms = mek.messages[0];
            if (!ms?.message || ms.key.fromMe) return;

            const s = await getCachedSettings();
            const autoReactMode = s.AUTO_REACT || "off";
            if (autoReactMode === "off" || autoReactMode === "false") return;

            const from = ms.key.remoteJid;
            const isGroup = from?.endsWith("@g.us");
            const isDm = from?.endsWith("@s.whatsapp.net");

            const shouldReact =
                autoReactMode === "all" ||
                autoReactMode === "true" ||
                (autoReactMode === "dm" && isDm) ||
                (autoReactMode === "groups" && isGroup);

            if (!shouldReact) return;

            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            await GiftedAutoReact(randomEmoji, ms, Gifted);
        } catch (err) {
            console.error("Error during auto reaction:", err);
        }
    });
}

// ─── Anti Delete ─────────────────────────────────────────────────────────────
function setupAntiDelete(Gifted) {
    const botJid = `${Gifted.user?.id.split(":")[0]}@s.whatsapp.net`;

    const realJid = (j) => (j && !j.endsWith("@lid") ? j : null);

    const getSender = (ms) => {
        const { key } = ms;
        return (
            realJid(key.participantPn) ||
            realJid(key.senderPn) ||
            realJid(ms.senderPn) ||
            realJid(key.participant) ||
            realJid(ms.participant) ||
            key.participantPn ||
            key.participant ||
            ms.participant ||
            (key.remoteJid?.endsWith("@g.us")
                ? null
                : realJid(key.remoteJid) || key.remoteJid)
        );
    };

    const getPushName = (ms) =>
        ms.pushName || ms.key?.pushName || ms.verifiedBizName || "Unknown";

    const getProtocolMessage = (ms) =>
        ms.message?.protocolMessage ||
        ms.message?.ephemeralMessage?.message?.protocolMessage ||
        ms.message?.viewOnceMessage?.message?.protocolMessage ||
        ms.message?.viewOnceMessageV2?.message?.protocolMessage;

    const getActualMessage = (ms) => {
        const msg = ms.message;
        if (!msg) return null;
        return (
            msg.ephemeralMessage?.message ||
            msg.viewOnceMessage?.message ||
            msg.viewOnceMessageV2?.message ||
            msg.documentWithCaptionMessage?.message ||
            msg
        );
    };

    Gifted.ev.on("messages.upsert", async ({ messages }) => {
        for (const ms of messages) {
            try {
                if (!ms?.message) continue;
                const { key } = ms;
                if (!key?.remoteJid || key.fromMe || key.remoteJid === "status@broadcast") continue;

                const protocolMsg = getProtocolMessage(ms);

                if (protocolMsg?.type === 0) {
                    const deletedId = protocolMsg.key?.id;
                    const chatJid = key.remoteJid;
                    if (!deletedId) continue;

                    const deletedMsg = findAntiDelete(chatJid, deletedId);
                    if (!deletedMsg?.message) continue;

                    const deleter = getSender(ms) || key.remoteJid;
                    if (deleter === botJid) continue;

                    await GiftedAntiDelete(
                        Gifted,
                        deletedMsg,
                        key,
                        deleter,
                        deletedMsg.originalSender,
                        botJid,
                        getPushName(ms),
                        deletedMsg.originalPushName
                    );
                    removeAntiDelete(chatJid, deletedId);
                    continue;
                }

                if (protocolMsg) continue;

                const actualMessage = getActualMessage(ms);
                if (!actualMessage) continue;

                const from = key.remoteJid;
                const isGroup = from.endsWith("@g.us");

                const isSticker =
                    ms.message?.stickerMessage ||
                    ms.message?.ephemeralMessage?.message?.stickerMessage ||
                    ms.message?.viewOnceMessageV2?.message?.stickerMessage;

                if (isGroup && isSticker) {
                    await antiStickerHandler(ms, Gifted);
                }

                const sender = getSender(ms);
                if (!sender || sender === botJid) continue;

                const entry = {
                    ...ms,
                    message: actualMessage,
                    originalSender: sender,
                    originalPushName: getPushName(ms),
                    timestamp: Date.now(),
                };
                setImmediate(() => saveAntiDelete(from, entry));
            } catch (error) {
                logger.error("Anti-delete system error:", error);
            }
        }
    });
}

// ─── Auto Bio ────────────────────────────────────────────────────────────────
function setupAutoBio(Gifted) {
    (async () => {
        const s = await getCachedSettings();
        if (s.AUTO_BIO === "true") {
            setTimeout(() => GiftedAutoBio(Gifted), 1000);
            setInterval(() => GiftedAutoBio(Gifted), 60_000);
        }
    })();
}

// ─── Anti Call ───────────────────────────────────────────────────────────────
function setupAntiCall(Gifted) {
    Gifted.ev.on("call", (json) => GiftedAnticall(json, Gifted));
}

// ─── Newsletter React ────────────────────────────────────────────────────────
function setupNewsletterReact(Gifted) {
    const emojiList = ["❤️", "💛", "👍", "💜", "😮", "🤍", "💙"];
    Gifted.ev.on("messages.upsert", async (mek) => {
        try {
            const msg = mek.messages[0];
            if (!msg?.message || !msg?.key?.server_id) return;

            const newsletters = await getNewsletters();
            if (!newsletters.includes(msg.key.remoteJid)) return;

            const emoji = emojiList[Math.floor(Math.random() * emojiList.length)];
            await Gifted.newsletterReactMessage(
                msg.key.remoteJid,
                msg.key.server_id.toString(),
                emoji
            );
        } catch (err) {
            if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].includes(err?.code)) {
                _newsletterCache = null;
            }
        }
    });
}

// ─── Presence ────────────────────────────────────────────────────────────────
function setupPresence(Gifted) {
    Gifted.ev.on("messages.upsert", async ({ messages }) => {
        if (messages?.length > 0) {
            await GiftedPresence(Gifted, messages[0].key.remoteJid);
        }
    });

    Gifted.ev.on("connection.update", ({ connection }) => {
        if (connection === "open") {
            GiftedPresence(Gifted, "status@broadcast");
        }
    });
}

// ─── ChatBot + AntiLink ──────────────────────────────────────────────────────
function setupChatBotAndAntiLink(Gifted) {
    Gifted.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type === "append") return;

        const firstMsg = messages[0];
        if (firstMsg?.message) {
            const s = await getCachedSettings();
            if (s.CHATBOT === "true" || s.CHATBOT === "audio") {
                GiftedChatBot(
                    Gifted,
                    s.CHATBOT,
                    s.CHATBOT_MODE || "inbox",
                    createContext,
                    createContext2,
                    googleTTS
                );
            }
        }

        for (const message of messages) {
            if (!message?.message) continue;
            const from = message.key?.remoteJid || "";
            if (message.key.fromMe && !from.endsWith("@g.us")) continue;

            if (from.endsWith("@g.us")) {
                await Promise.allSettled([
                    GiftedAntiLink(Gifted, message, getGroupMetadata),
                    GiftedAntibad(Gifted, message, getGroupMetadata),
                ]);
            }
            await Promise.allSettled([
                GiftedAntiGroupMention(Gifted, message, getGroupMetadata),
                handleGameMessage(Gifted, message),
            ]);
        }
    });
}

// ─── Anti Edit ───────────────────────────────────────────────────────────────
function setupAntiEdit(Gifted) {
    Gifted.ev.on("messages.update", async (updates) => {
        for (const update of updates) {
            try {
                if (!update?.update?.message) continue;
                if (update.key?.fromMe) continue;
                if (update.key?.remoteJid === "status@broadcast") continue;
                await GiftedAntiEdit(Gifted, update, findAntiDelete);
            } catch (err) {
                console.error("Anti-edit handler error:", err.message);
            }
        }
    });
}

// ─── Status Handlers ─────────────────────────────────────────────────────────
function setupStatusHandlers(Gifted) {
    Gifted.ev.on("messages.upsert", async (mek) => {
        try {
            mek = mek.messages[0];
            if (!mek?.message) return;

            mek.message =
                getContentType(mek.message) === "ephemeralMessage"
                    ? mek.message.ephemeralMessage.message
                    : mek.message;

            if (mek.key?.remoteJid !== "status@broadcast") return;

            const s = await getCachedSettings();
            const rawParticipant =
                mek.participant || mek.key.participantPn || mek.key.participant;
            const participantJid = await resolveRealJid(Gifted, rawParticipant);

            const shouldView = s.AUTO_READ_STATUS === "true";
            const readKey =
                participantJid && participantJid !== mek.key.participant
                    ? { ...mek.key, participant: participantJid }
                    : mek.key;

            if (shouldView) await Gifted.readMessages([readKey]);

            if (shouldView && s.AUTO_LIKE_STATUS === "true" && participantJid) {
                const statusEmojis = (s.STATUS_LIKE_EMOJIS || "💛,❤️,💜,🤍,💙")
                    .split(",")
                    .map((e) => e.trim())
                    .filter(Boolean);
                const randomEmoji =
                    statusEmojis[Math.floor(Math.random() * statusEmojis.length)];
                await Gifted.sendMessage(
                    "status@broadcast",
                    { react: { text: randomEmoji, key: { ...mek.key, participant: participantJid } } },
                    { statusJidList: [participantJid] }
                );
            }

            if (
                shouldView &&
                s.AUTO_REPLY_STATUS === "true" &&
                !mek.key.fromMe &&
                participantJid
            ) {
                await Gifted.sendMessage(
                    participantJid,
                    { text: s.STATUS_REPLY_TEXT || DEFAULT_SETTINGS.STATUS_REPLY_TEXT },
                    { quoted: mek }
                );
            }
        } catch (error) {
            const code = error?.output?.statusCode || error?.code || "";
            const msg = error?.message || "";
            const transient =
                code === 428 ||
                msg === "Connection Closed" ||
                ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"].some((e) =>
                    msg.includes(e)
                ) ||
                msg.includes("Connection Terminated") ||
                msg.includes("Stream Errored") ||
                ["ECONNRESET", "EPIPE"].includes(String(code));
            if (!transient) console.error("Error Processing Status Actions:", error);
        }
    });
}

// ─── Command Handler ─────────────────────────────────────────────────────────
function setupCommandHandler(Gifted) {
    Gifted.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type === "append") return;

        const ms = messages[0];
        if (!ms?.message || !ms?.key) return;

        const messageId = ms.key.id;
        if (!markProcessed(messageId)) return;

        const messageTimestamp =
            (ms.messageTimestamp?.low || ms.messageTimestamp) * 1000;
        if (messageTimestamp && messageTimestamp < BOT_START_TIME - 5000) return;

        // Fetch settings and botId in parallel
        const [settings, botId] = await Promise.all([
            getCachedSettings(),
            Promise.resolve(standardizeJid(Gifted.user?.id)),
        ]);

        const serialized = await serializeMessage(ms, Gifted, settings);
        if (!serialized) return;

        const {
            from,
            isGroup,
            body,
            isCommand,
            command,
            args,
            sender: rawSender,
            messageAuthor,
            user,
            pushName,
            quoted,
            repliedMessage,
            mentionedJid,
            tagged,
            quotedMsg,
            quotedKey,
            quotedUser,
        } = serialized;

        // Fetch group info and superusers in parallel
        const [groupData, superUser] = await Promise.all([
            getGroupInfo(Gifted, from, botId, rawSender),
            buildSuperUsers(settings, getSudoNumbers, botId, settings.OWNER_NUMBER || ""),
        ]);

        const {
            groupInfo,
            groupName,
            participants,
            groupAdmins,
            groupSuperAdmins,
            isBotAdmin,
            isAdmin,
            isSuperAdmin,
            sender,
        } = groupData;

        const isSuperUser = superUser.includes(sender);

        // Auto-block
        if (settings.AUTO_BLOCK && sender && !isSuperUser && !isGroup) {
            const countryCodes = settings.AUTO_BLOCK.split(",").map((c) => c.trim());
            if (countryCodes.some((code) => sender.startsWith(code))) {
                Gifted.updateBlockStatus(sender, "block").catch((e) =>
                    console.error("Block error:", e)
                );
            }
        }

        // Auto-read
        const autoReadMode = settings.AUTO_READ_MESSAGES || "off";
        const shouldRead =
            autoReadMode === "all" ||
            autoReadMode === "true" ||
            (autoReadMode === "dm" && !isGroup) ||
            (autoReadMode === "groups" && isGroup) ||
            (autoReadMode === "commands" && isCommand);

        if (shouldRead) await Gifted.readMessages([ms.key]);

        // Shared context data
        const contextData = {
            from,
            isGroup,
            groupInfo,
            groupName,
            participants,
            groupAdmins,
            groupSuperAdmins,
            isBotAdmin,
            isAdmin,
            isSuperAdmin,
            sender,
            superUser,
            isSuperUser,
            messageAuthor,
            user,
            pushName,
            args,
            quoted,
            repliedMessage,
            mentionedJid,
            tagged,
            quotedMsg,
            quotedKey,
            quotedUser,
            Gifted,
            botId,
            body,
            command,
        };

        // Body commands
        const bodyCmd = findBodyCommand(body);
        if (bodyCmd?.function) {
            if (settings.MODE?.toLowerCase() !== "private" || isSuperUser) {
                try {
                    const helpers = createHelpers(Gifted, ms, from);
                    const conText = buildContext(ms, settings, helpers, contextData);
                    await bodyCmd.function(from, Gifted, conText);
                } catch (error) {
                    console.error("Body command error:", error);
                }
            }
        }

        // Prefix commands
        if (isCommand && command) {
            const gmd = findCommand(command);
            if (!gmd) return;
            if (settings.MODE?.toLowerCase() === "private" && !isSuperUser) return;

            try {
                const helpers = createHelpers(Gifted, ms, from);

                // React
                if (settings.AUTO_REACT === "commands") {
                    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                    await Gifted.sendMessage(from, { react: { key: ms.key, text: randomEmoji } });
                } else if (gmd.react) {
                    await Gifted.sendMessage(from, { react: { key: ms.key, text: gmd.react } });
                }

                setupGiftedHelpers(Gifted, from);
                const conText = buildContext(ms, settings, helpers, contextData);
                await gmd.function(from, Gifted, conText);
            } catch (error) {
                console.error(`Command error [${command}]:`, error);
                try {
                    await Gifted.sendMessage(
                        from,
                        {
                            text: `🚨 Command failed: ${error.message}`,
                            ...(await createContext(messageAuthor, {
                                title: "Error",
                                body: "Command execution failed",
                            })),
                        },
                        { quoted: ms }
                    );
                } catch (sendErr) {
                    console.error("Error sending error message:", sendErr);
                }
            }
        }
    });
}

// ─── Gifted Helpers ──────────────────────────────────────────────────────────
function setupGiftedHelpers(Gifted, from) {
    Gifted.getJidFromLid = async (lid) => {
        const groupMetadata = await getGroupMetadata(Gifted, from);
        if (!groupMetadata) return null;
        const match = groupMetadata.participants.find(
            (p) => p.lid === lid || p.id === lid
        );
        return match?.pn || match?.phoneNumber || null;
    };

    Gifted.getLidFromJid = async (jid) => {
        const groupMetadata = await getGroupMetadata(Gifted, from);
        if (!groupMetadata) return null;
        const match = groupMetadata.participants.find(
            (p) => p.jid === jid || p.pn === jid || p.phoneNumber === jid || p.id === jid
        );
        return match?.lid || null;
    };

    Gifted.downloadAndSaveMediaMessage = async (
        message,
        filename,
        attachExtension = true
    ) => {
        try {
            const quoted = message.msg ? message.msg : message;
            const mime = (message.msg || message).mimetype || "";
            const messageType = message.mtype
                ? message.mtype.replace(/Message/gi, "")
                : mime.split("/")[0];

            const stream = await downloadContentFromMessage(quoted, messageType);
            const buffer = await streamToBuffer(stream);

            let fileTypeResult;
            try {
                fileTypeResult = await fileTypeModule?.fileTypeFromBuffer(buffer);
            } catch (_) {}

            const extension =
                fileTypeResult?.ext ||
                mime.split("/")[1] ||
                (messageType === "image"
                    ? "jpg"
                    : messageType === "video"
                      ? "mp4"
                      : messageType === "audio"
                        ? "mp3"
                        : "bin");

            const trueFileName = attachExtension ? `${filename}.${extension}` : filename;
            await fs.writeFile(trueFileName, buffer);
            return trueFileName;
        } catch (error) {
            console.error("Error in downloadAndSaveMediaMessage:", error);
            throw error;
        }
    };
}

// ─── Context Builder ─────────────────────────────────────────────────────────
function buildContext(ms, settings, helpers, data) {
    return {
        m: ms,
        mek: ms,
        body: data.body || "",
        edit: helpers.edit,
        react: helpers.react,
        del: helpers.del,
        args: data.args,
        arg: data.args,
        quoted: data.quoted,
        isCmd: data.isCommand !== undefined ? data.isCommand : true,
        command: data.command || "",
        isAdmin: data.isAdmin,
        isBotAdmin: data.isBotAdmin,
        sender: data.sender,
        pushName: data.pushName,
        setSudo,
        delSudo,
        q: data.args.join(" "),
        reply: helpers.reply,
        config,
        superUser: data.superUser,
        tagged: data.tagged,
        mentionedJid: data.mentionedJid,
        isGroup: data.isGroup,
        groupInfo: data.groupInfo,
        groupName: data.groupName,
        getSudoNumbers,
        authorMessage: data.messageAuthor,
        user: data.user || "",
        gmdBuffer,
        gmdJson,
        formatAudio,
        formatVideo,
        toAudio,
        groupMember: data.isGroup ? data.messageAuthor : "",
        from: data.from,
        groupAdmins: data.groupAdmins,
        participants: data.participants,
        repliedMessage: data.repliedMessage,
        quotedMsg: data.quotedMsg,
        quotedKey: data.quotedKey,
        quotedUser: data.quotedUser,
        isSuperUser: data.isSuperUser,
        botMode: settings.MODE,
        botPic: settings.BOT_PIC,
        botFooter: settings.FOOTER,
        botCaption: settings.CAPTION,
        botVersion: settings.VERSION,
        ownerNumber: settings.OWNER_NUMBER,
        ownerName: settings.OWNER_NAME,
        botName: settings.BOT_NAME,
        giftedRepo: settings.BOT_REPO,
        packName: settings.PACK_NAME,
        packAuthor: settings.PACK_AUTHOR,
        isSuperAdmin: data.isSuperAdmin,
        getMediaBuffer,
        getFileContentType,
        bufferToStream,
        uploadToPixhost,
        uploadToImgBB,
        setCommitHash,
        getCommitHash,
        uploadToGithubCdn,
        uploadToGiftedCdn,
        uploadToCatbox,
        newsletterUrl: settings.NEWSLETTER_URL,
        newsletterJid: settings.NEWSLETTER_JID,
        GiftedTechApi,
        GiftedApiKey,
        botPrefix: settings.PREFIX,
        timeZone: settings.TIME_ZONE,
    };
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
(async () => {
    await loadSession();
    await loadBotSettings();
    startGifted();
})();
