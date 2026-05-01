import express from "express";
import * as line from "@line/bot-sdk";
import { google } from "googleapis";

// ===== LINE設定 =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// ===== 管理者 =====
const ADMIN_IDS = [
  "U1a1aca9e44466f8cb05003d7dc86fee0",
];

// ===== Sheets =====
const SPREADSHEET_ID = "1ZgDYtjmF0eNSab654gGLrfl11i_jmaVQW2WmaVRV1Lw";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// ===== LINE =====
const client = new line.Client(config);

// ===== Express =====
const app = express();

app.get("/", (req, res) => {
  res.send("BOT起動中");
});

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// ===== 処理 =====
async function handleEvent(event) {
  if (event.type !== "message") return;

  const text = event.message.text;
  const userId = event.source.userId;

  // 動作確認
  if (text === "ping") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "pong（OK）",
    });
  }

  // Sheets保存
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sheet1!A:D",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        new Date().toLocaleString("ja-JP"),
        userId,
        event.source.groupId || "個チャ",
        text
      ]],
    },
  });

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "保存した",
  });
}

// ===== 起動 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 起動成功 " + PORT);
});
