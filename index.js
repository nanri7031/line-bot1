import express from "express";
import line from "@line/bot-sdk";
import { google } from "googleapis";

// ===== LINE設定 =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// ===== Google Sheets設定 =====
const SPREADSHEET_ID = "1ZgDYtjmF0eNSab654gGLrfl11i_jmaVQW2WmaVRV1Lw";

// Renderに入れたJSONを使う
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// ===== Express =====
const app = express();
const client = new line.Client(config);

app.post("/webhook", line.middleware(config), async (req, res) => {
  await Promise.all(req.body.events.map(handleEvent));
  res.status(200).end();
});

app.get("/", (req, res) => {
  res.send("BOT起動中");
});

// ===== メイン処理 =====
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return null;

  const text = event.message.text;
  const groupId = event.source.groupId || event.source.roomId || "user";

  // ===== 確認コマンド =====
  if (text === "確認") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "BOT正常稼働中🔥",
    });
  }

  // ===== データ保存 =====
  if (text.startsWith("登録")) {
    const data = text.replace("登録 ", "");

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "A:B",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[groupId, data]],
      },
    });

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "登録完了👍",
    });
  }

  // ===== データ一覧 =====
  if (text === "一覧") {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "A:B",
    });

    const rows = res.data.values || [];

    const filtered = rows.filter((r) => r[0] === groupId);

    if (filtered.length === 0) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "データなし",
      });
    }

    const list = filtered.map((r, i) => `${i + 1}. ${r[1]}`).join("\n");

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: list,
    });
  }

  return null;
}

// ===== 起動 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running ${PORT}`));
