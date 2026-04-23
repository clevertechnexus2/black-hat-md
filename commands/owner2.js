const { gmd, commands, getSetting } = require("../black_hat");
const { downloadContentFromMessage } = require("gifted-baileys");
const FormData = require("form-data");
const { Blob } = require("buffer");
const axios = require("axios");
const fs = require("fs").promises;
const fsA = require("node:fs");
const { S_WHATSAPP_NET } = require("gifted-baileys");
const { Jimp } = require("jimp");
const path = require("path");
const moment = require("moment-timezone");
const {
  groupCache,
  getGroupMetadata,
  cachedGroupMetadata,
} = require("../black_hat/connection/groupCache");

const { exec: _shellExec } = require("child_process");

gmd(
  {
    pattern: "$",
    on: "body",
    react: "🖥️",
    category: "owner",
    dontAddCommandList: true,
    description: "Run a shell command. Usage: $ <command>",
  },
  async (from, Gifted, conText) => {
    const { reply, react, isSuperUser, body } = conText;
    if (!body.startsWith("$")) return;
    if (!isSuperUser) return;

    const shellCmd = body.slice(1).trim();
    if (!shellCmd) return reply("Usage: $ <command>");

    await react("⏳");
    _shellExec(shellCmd, { timeout: 30000, maxBuffer: 1024 * 1024 * 5 }, async (err, stdout, stderr) => {
      const output = (stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : "");
      const result = err && !output.trim()
        ? `❌ Error: ${err.message}`
        : output.trim() || "(no output)";
      await react("✅");
      await reply("```\n" + result.slice(0, 4000) + "\n```");
    });
  }
);

gmd(
  {
    pattern: ">",
    on: "body",
    react: "⚡",
    category: "owner",
    dontAddCommandList: true,
    description: "Evaluate a JavaScript expression. Usage: > <code>",
  },
  async (from, Gifted, conText) => {
    const { mek, reply, react, isSuperUser, body } = conText;
    if (!body.startsWith(">")) return;
    if (!isSuperUser) return reply("❌ Owner only");

    const code = body.slice(1).trim();
    if (!code) return reply("Usage: > <js expression>");

    await react("⏳");
    try {
      const gift = require("../black_hat");
      const _rawDb = require("../black_hat/database/database").DATABASE;
      const settings = await gift.getAllSettings();
      const { getSetting, setSetting, getAllSettings, commands } = gift;
      const prefix = settings.PREFIX;
      const botPrefix = settings.PREFIX;
      const db = new Proxy({ raw: _rawDb }, {
        get(target, key) {
          if (key === 'raw') return _rawDb;
          if (key === 'toJSON') return () => settings;
          if (key === 'toString') return () => JSON.stringify(settings, null, 2);
          const upper = String(key).toUpperCase();
          if (upper in settings) return settings[upper];
          return target[key];
        }
      });
      const bot = Gifted;
      const m = mek;
      const {
        sender, isGroup, groupInfo, groupName, participants,
        isSuperAdmin, isAdmin, isBotAdmin, superUser,
        botName, ownerNumber, ownerName,
      } = conText;

      let result;
      try {
        result = await eval(`(async () => { return (${code}) })()`);
      } catch (e1) {
        result = await eval(`(async () => { ${code} })()`);
      }
      if (result === undefined) result = "(undefined)";
      let output;
      if (typeof result === "object" && result !== null) {
        try {
          output = JSON.stringify(result, null, 2);
        } catch (_) {
          output = String(result);
        }
      } else {
        output = String(result);
      }
      await react("✅");
      await reply("```\n" + output.slice(0, 4000) + "\n```");
    } catch (err) {
      await react("❌");
      await reply(`❌ Error: ${err.message}`);
    }
  }
);

gmd(
  {
    pattern: "rmbg",
    category: "owner",
    react: "🧠",
    description: "Remove background from an image (reply to image)",
  },
  async (from, Gifted, conText) => {
    const { reply, mek, react, sender, botName, newsletterJid } = conText;

    try {
      const msg = mek;

      // Get quoted message
      const quoted =
        msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;

      if (!quoted) {
        return reply("❌ Please reply to an image");
      }

      // Extract image message
      const imageMsg = quoted.imageMessage || quoted.documentMessage;

      if (!imageMsg) {
        return reply("❌ Reply to a valid image");
      }

      await react("⏳");

      // Download buffer
      const stream = await downloadContentFromMessage(imageMsg, "image");

      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }

      // Convert Buffer → Blob (IMPORTANT FIX)
      const blob = new Blob([buffer], { type: "image/png" });

      // Prepare FormData
const form = new FormData();

form.append("image_file", buffer, {
  filename: "image.png",
  contentType: "image/png",
});

      // API KEY
      const API_KEY = process.env.REMOVE_BG_API || "SbjibtuwvtFPyf9Vvv1bUog9";

      // Call remove.bg API
      const res = await axios.post(
        "https://api.remove.bg/v1.0/removebg",
        form,
        {
          headers: {
            ...form.getHeaders(),
            "X-Api-Key": API_KEY,
          },
          responseType: "arraybuffer",
        }
      );

      const outputBuffer = Buffer.from(res.data, "binary");

      await react("✅");

      // Send result
      await Gifted.sendMessage(from, {
        image: outputBuffer,
        caption: "✅ Background removed",
        contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: newsletterJid,
                            newsletterName: botName,
                            serverMessageId: 143,
                        },
                    },
      });

    } catch (err) {
      console.error(err);
      await react("❌");
      reply("❌ Failed to remove background");
    }
  }
);

gmd(
  {
    pattern: "wasted",
    category: "owner",
    react: "💀",
    description: "Make someone look WASTED 💀",
  },
  async (from, Gifted, conText) => {
    const { reply, mek, react, sender, botName, newsletterJid } = conText;

    try {
      const msg = mek;

      let userToWaste;

      // ✅ Mention
      const mentioned =
        msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid;

      if (mentioned && mentioned.length > 0) {
        userToWaste = mentioned[0];
      }

      // ✅ Reply
      else {
        const quoted =
          msg?.message?.extendedTextMessage?.contextInfo?.participant;

        if (quoted) {
          userToWaste = quoted;
        }
      }

      if (!userToWaste) {
        return reply("⚠️ Mention or reply to a user to use .wasted");
      }

      await react("⏳");

      // Get profile picture
      let profilePic;
      try {
        profilePic = await Gifted.profilePictureUrl(userToWaste, "image");
      } catch {
        profilePic = "https://i.imgur.com/9aciic.jpeg";
      }

      // Call API
      const res = await axios.get(
        `https://some-random-api.com/canvas/overlay/wasted?avatar=${encodeURIComponent(profilePic)}`,
        { responseType: "arraybuffer" }
      );

      await react("💀");

      await Gifted.sendMessage(from, {
        image: Buffer.from(res.data),
        caption: `⚰️ *Wasted* : @${userToWaste.split("@")[0]} 💀\nRest in pieces!`,
        mentions: [userToWaste],
        contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: newsletterJid,
                            newsletterName: botName,
                            serverMessageId: 143,
                        },
                    },
      });

    } catch (err) {
      console.error(err);
      await react("❌");
      reply("❌ Failed to generate wasted image");
    }
  }
);

// ================== NEWSLETTER COMMAND (PRO + BUTTONS) ==================

const { sendButtons } = require("gifted-btns");

function extractCode(link) {
  try {
    let clean = link.trim().split("?")[0].split("#")[0];

    const match = clean.match(/channel\/([A-Za-z0-9]+)/i);
    if (match) return match[1];

    if (/^[A-Za-z0-9]+$/.test(clean)) return clean;

    return null;
  } catch {
    return null;
  }
}

gmd(
  {
    pattern: "nl",
    category: "owner",
    react: "📰",
    description: "Get WhatsApp channel info",
  },
  async (from, Gifted, conText) => {
    const { reply, react, body, botName, botFooter } = conText;

    try {
      let text = body.replace(".nl", "").trim();

      if (!text) {
        return reply("❌ Example:\n.nl https://whatsapp.com/channel/xxxx");
      }

      const code = extractCode(text);

      if (!code) {
        return reply("❌ Invalid channel link");
      }

      await react("⏳");

      const meta = await Gifted.newsletterMetadata("invite", code);

      if (!meta) {
        return reply("❌ Channel not found");
      }

      const channelId = meta.id || code;
      const channelLink = `https://whatsapp.com/channel/${code}`;

      let msg =
`╭══〘〘 *📰 NEWSLETTER* 〙〙═⊷
┃ ID: ${channelId}
╰━━━━━━━━━━━━━━━━━━━⬣`;

      await react("✅");

      await sendButtons(Gifted, from, {
        title: "📰 NEWSLETTER INFO",
        text: msg,
        footer: botFooter || botName || "Bot",

        buttons: [
          {
            name: "cta_copy",
            buttonParamsJson: JSON.stringify({
              display_text: "📋 Copy ID",
              copy_code: channelId,
            }),
          },
          {
            name: "cta_copy",
            buttonParamsJson: JSON.stringify({
              display_text: "🔗 Copy Link",
              copy_code: channelLink,
            }),
          },
        ],
      });

    } catch (err) {
      console.error(err);
      await react("❌");

      if (err.message?.includes("newsletterMetadata")) {
        return reply("❌ Update Baileys (newsletter not supported)");
      }

      reply("❌ Failed to fetch channel info");
    }
  }
);

gmd(
  {
    pattern: "pair",
    on: "text",
    react: "🔗",
    category: "owner",
    description: "Generate WhatsApp pairing code",
  },
  async (from, Gifted, conText) => {
    const { body, reply, react, botName, botFooter } = conText;

    const number = body.split(" ")[1];
    if (!number) return reply("Usage: pair 2557XXXXXXX");

    const cleanNumber = number.replace(/[^0-9]/g, "");
    if (cleanNumber.length < 10) {
      return reply("❌ Invalid number");
    }

    await react("⏳");

    try {
      const url = `https://session.clevertechnexus.qzz.io/code?number=${cleanNumber}&type=short`;

      const { data } = await axios.get(url, { timeout: 60000 });

      if (!data || !data.code) {
        await react("❌");
        return reply("❌ No pairing code returned");
      }

      const code = data.code;
      const fallback = data.fallback;

      let msg =
`╭══〘〘 🔗 PAIRING CODE 〙〙═⊷
┃ 📱 Number: ${cleanNumber}
┃ 🔑 Code: ${code}
┃ ⚙️ Mode: ${fallback ? "Fallback" : "Short"}
╰━━━━━━━━━━━━━━━━━━━⬣`;

      await react("✅");

      await sendButtons(Gifted, from, {
        title: "🔗 WHATSAPP PAIRING SYSTEM",
        text: msg,
        footer: botFooter || botName || "Bot",

        buttons: [
          {
            name: "cta_copy",
            buttonParamsJson: JSON.stringify({
              display_text: "📋 Copy Code",
              copy_code: code,
            }),
          },
          {
            name: "cta_copy",
            buttonParamsJson: JSON.stringify({
              display_text: "📱 Copy Number",
              copy_code: cleanNumber,
            }),
          },
          {
            name: "cta_url",
            buttonParamsJson: JSON.stringify({
              display_text: "🌐 Open API",
              url: url,
            }),
          },
        ],
      });

    } catch (err) {
      console.error(err);
      await react("❌");
      return reply("❌ Error generating pairing code");
    }
  }
);
