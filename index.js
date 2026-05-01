import express from "express";
import line from "@line/bot-sdk";
import { google } from "googleapis";

// ===== LINE設定 =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// ===== 管理者ID（自分 + 追加OK）=====
const ADMIN_IDS = [
  "U1a1aca9e44466f8cb05003d7dc86fee0", // ←あなた
];

// ===== Google Sheets設定 =====
const SPREADSHEET_ID = "1ZgDYtjmF0eNSab654gGLrfl11i_jmaVQW2WmaVRV1Lw";

// 🔥 JSONはそのまま（改行OK）
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// ===== LINEクライアント =====
const client = new line.Client(config);

// ===== Express =====
const app = express();

app.get("/", (req, res) => {
  res.send("BOT起動中");
});

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// ===== イベント処理 =====
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const userId = event.source.userId;
  const text = event.message.text;

  // ===== BOT確認コマンド =====
  if (text === "ping") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "pong（BOT動いてる）",
    });
  }

  // ===== 管理者チェック =====
  const isAdmin = ADMIN_IDS.includes(userId);

  // ===== 管理者追加 =====
  if (text.startsWith("admin add ") && isAdmin) {
    const newId = text.replace("admin add ", "").trim();
    ADMIN_IDS.push(newId);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `管理者追加: ${newId}`,
    });
  }

  // ===== 管理者確認 =====
  if (text === "admin list") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: ADMIN_IDS.join("\n"),
    });
  }

  // ===== Sheetsに保存 =====
  await saveToSheet(event);

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "保存した",
  });
}

// ===== Sheets書き込み =====
async function saveToSheet(event) {
  const userId = event.source.userId;
  const groupId = event.source.groupId || "個チャ";
  const text = event.message.text;
  const time = new Date().toLocaleString("ja-JP");

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sheet1!A:D",
    valueInputOption: "RAW",
    requestBody: {
      values: [[time, userId, groupId, text]],
    },
  });
}

// ===== 起動 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on " + PORT);
});
