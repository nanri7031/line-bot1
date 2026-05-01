import express from "express";
import * as line from "@line/bot-sdk";
import { google } from "googleapis";

// ===== LINE =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// ===== 管理 =====
let ADMINS = ["U1a1aca9e44466f8cb05003d7dc86fee0"];
let SUB_ADMINS = [];

// ===== システム =====
let BAN_USERS = [];
let REPORT_COUNT = {};
let SPAM_COUNT = {};
let LAST_MESSAGE = {};
let NG_WORDS = ["死ね", "荒らし"];
let GREETING = true;
let SPAM_LIMIT = 5;

// ===== Sheets =====
const SPREADSHEET_ID = "1ZgDYtjmF0eNSab654gGLrfl11i_jmaVQW2WmaVRV1Lw";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// ===== LINE =====
const client = new line.Client(config);
const app = express();

app.get("/", (req, res) => res.send("BOT起動中"));

app.post("/webhook", line.middleware(config), async (req, res) => {
  await Promise.all(req.body.events.map(handleEvent));
  res.json({ ok: true });
});

// ===== メイン処理 =====
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text;
  const userId = event.source.userId;
  const groupId = event.source.groupId || "個チャ";

  const isAdmin = ADMINS.includes(userId);
  const isSub = SUB_ADMINS.includes(userId);

  // ===== BAN無反応 =====
  if (BAN_USERS.includes(userId)) return;

  // ===== 稼働確認 =====
  if (text === "ping") return reply(event, "pong（正常稼働中）");

  // ===== 挨拶 =====
  if (GREETING && (text === "こんにちは" || text === "おはよう")) {
    const msg = ["よろしく！", "どうも！", "いらっしゃい！"];
    return reply(event, msg[Math.floor(Math.random() * msg.length)]);
  }

  // ===== 連投制限 =====
  const now = Date.now();
  if (!LAST_MESSAGE[userId]) LAST_MESSAGE[userId] = [];
  LAST_MESSAGE[userId].push(now);
  LAST_MESSAGE[userId] = LAST_MESSAGE[userId].filter(t => now - t < 10000);

  if (LAST_MESSAGE[userId].length > SPAM_LIMIT) {
    BAN_USERS.push(userId);
    return reply(event, "⚠️ 連投BAN");
  }

  // ===== NGワード =====
  for (let w of NG_WORDS) {
    if (text.includes(w)) {
      BAN_USERS.push(userId);
      return reply(event, "⚠️ NGワードBAN");
    }
  }

  // ===== 通報 =====
  if (text.startsWith("通報 ")) {
    const target = text.replace("通報 ", "").trim();
    REPORT_COUNT[target] = (REPORT_COUNT[target] || 0) + 1;

    if (REPORT_COUNT[target] >= 3) {
      BAN_USERS.push(target);
      return reply(event, "🚫 通報によりBAN");
    }
    return reply(event, "通報受付");
  }

  // ===== 管理 =====
  if (text.startsWith("admin add ") && isAdmin) {
    ADMINS.push(text.replace("admin add ", "").trim());
    return reply(event, "管理追加");
  }

  if (text.startsWith("admin remove ") && isAdmin) {
    ADMINS = ADMINS.filter(a => a !== text.replace("admin remove ", "").trim());
    return reply(event, "削除");
  }

  if (text === "admin list") return reply(event, ADMINS.join("\n"));

  // ===== 副管理 =====
  if (text.startsWith("sub add ") && isAdmin) {
    SUB_ADMINS.push(text.replace("sub add ", "").trim());
    return reply(event, "副管理追加");
  }

  if (text.startsWith("sub remove ") && isAdmin) {
    SUB_ADMINS = SUB_ADMINS.filter(a => a !== text.replace("sub remove ", "").trim());
    return reply(event, "副管理削除");
  }

  if (text === "sub list") return reply(event, SUB_ADMINS.join("\n"));

  // ===== BAN管理 =====
  if (text === "ban list") return reply(event, BAN_USERS.join("\n"));

  if (text.startsWith("unban ") && (isAdmin || isSub)) {
    const id = text.replace("unban ", "").trim();
    BAN_USERS = BAN_USERS.filter(u => u !== id);
    return reply(event, "解除");
  }

  // ===== NG管理 =====
  if (text.startsWith("ng add ") && (isAdmin || isSub)) {
    NG_WORDS.push(text.replace("ng add ", "").trim());
    return reply(event, "NG追加");
  }

  // ===== 挨拶切替 =====
  if (text === "greet on") GREETING = true;
  if (text === "greet off") GREETING = false;

  // ===== ログ保存 =====
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sheet1!A:D",
    valueInputOption: "RAW",
    requestBody: {
      values: [[new Date().toLocaleString(), userId, groupId, text]]
    }
  });

  return reply(event, "OK");
}

// ===== 返信 =====
function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: "text",
    text
  });
}

// ===== 起動 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 最強BOT起動");
});
