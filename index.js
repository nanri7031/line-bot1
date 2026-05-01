import express from "express";
import * as line from "@line/bot-sdk";
import { google } from "googleapis";

// ===== LINE設定 =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// ===== 管理 =====
let ADMINS = ["U1a1aca9e44466f8cb05003d7dc86fee0"];
let SUB_ADMINS = [];

// ===== システム =====
let BAN_USERS = [];
let NG_WORDS = ["死ね", "荒らし"];
let GREETING = true;
let SPAM_LIMIT = 5;
let MESSAGE_LOG = {};
let REPORT_COUNT = {};

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

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  await Promise.all(req.body.events.map(handleEvent));
  res.json({ ok: true });
});

// ===== メイン処理 =====
async function handleEvent(event) {

  // ===== メニュー（最優先に置く）=====
  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text;

    if (text === "menu") {
      return client.replyMessage(event.replyToken, {
        type: "flex",
        altText: "管理メニュー",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              button("管理一覧", "admin list"),
              button("副管理一覧", "sub list"),
              button("BAN一覧", "ban list"),
              button("NG一覧", "ng list"),
              button("状態確認", "ping")
            ]
          }
        }
      });
    }
  }

  // ===== 通常処理 =====
  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text;
  const userId = event.source.userId;
  const groupId = event.source.groupId || "個チャ";

  const isAdmin = ADMINS.includes(userId);
  const isSub = SUB_ADMINS.includes(userId);

  // ===== BAN無反応 =====
  if (BAN_USERS.includes(userId)) return;

  // ===== 稼働確認 =====
  if (text === "ping") return reply(event, "pong（稼働中）");

  // ===== 挨拶 =====
  if (GREETING && ["こんにちは", "おはよう"].includes(text)) {
    const msg = ["よろしく！", "どうも！", "いらっしゃい！"];
    return reply(event, msg[Math.floor(Math.random() * msg.length)]);
  }

  // ===== 連投 =====
  if (!MESSAGE_LOG[userId]) MESSAGE_LOG[userId] = [];
  MESSAGE_LOG[userId].push(Date.now());
  MESSAGE_LOG[userId] = MESSAGE_LOG[userId].filter(t => Date.now() - t < 10000);

  if (MESSAGE_LOG[userId].length > SPAM_LIMIT) {
    BAN_USERS.push(userId);
    return reply(event, "⚠️ 連投BAN");
  }

  // ===== NG =====
  for (let w of NG_WORDS) {
    if (text.includes(w)) {
      BAN_USERS.push(userId);
      return reply(event, "⚠️ NGワードBAN");
    }
  }

  // ===== 通報 =====
  if (text.startsWith("通報 ")) {
    const id = text.replace("通報 ", "").trim();
    REPORT_COUNT[id] = (REPORT_COUNT[id] || 0) + 1;

    if (REPORT_COUNT[id] >= 3) {
      BAN_USERS.push(id);
      return reply(event, "🚫 通報BAN");
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
    BAN_USERS = BAN_USERS.filter(u => u !== text.replace("unban ", "").trim());
    return reply(event, "解除");
  }

  // ===== NG管理 =====
  if (text.startsWith("ng add ") && (isAdmin || isSub)) {
    NG_WORDS.push(text.replace("ng add ", "").trim());
    return reply(event, "NG追加");
  }

  if (text === "ng list") return reply(event, NG_WORDS.join(", "));

  // ===== 保存 =====
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

// ===== ボタン =====
function button(label, text) {
  return {
    type: "button",
    style: "primary",
    color: "#1E90FF",
    action: { type: "message", label, text }
  };
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
app.listen(PORT, () => console.log("🚀 最強BOT起動"));
