import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import { google } from "googleapis";

const app = express();

// ===== LINE =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new Client(config);

const reply = (token, text) =>
  client.replyMessage(token, { type: "text", text });

// ===== Google =====
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.SPREADSHEET_ID;

// ===== 固定 =====
const OWNER_ID = "U1a1aca9e44466f8cb05003d7dc86fee0";
const ADMIN_PASS = "1234";

// ===== 設定 =====
async function getSettings(groupId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "settings!A:C"
  });
  const rows = res.data.values || [];
  return rows.find(r => r[0] === groupId);
}

async function ensureSettings(groupId) {
  const exist = await getSettings(groupId);
  if (!exist) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "settings!A:C",
      valueInputOption: "RAW",
      requestBody: { values: [[groupId, "5", "ON"]] }
    });
  }
}

// ===== 管理者 =====
async function isAdmin(groupId, userId) {
  if (userId === OWNER_ID) return true;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "admins!A:B"
  });

  const rows = res.data.values || [];
  return rows.some(r => r[0] === groupId && r[1] === userId);
}

// ===== NG =====
async function getNG(groupId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "ng!A:B"
  });
  const rows = res.data.values || [];
  return rows.filter(r => r[0] === groupId);
}

async function addNG(groupId, word) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "ng!A:B",
    valueInputOption: "RAW",
    requestBody: { values: [[groupId, word]] }
  });
}

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req, res) => {

  for (const event of req.body.events) {

    if (!event.source.groupId) continue;

    const groupId = event.source.groupId;
    const userId = event.source.userId;

    await ensureSettings(groupId);
    const setting = await getSettings(groupId);

    if (event.type !== "message") continue;
    if (event.message.type !== "text") continue;

    const text = event.message.text.trim();

    // ===== menu =====
    if (text === "menu") {
      return reply(event.replyToken,
        "管理メニュー\n" +
        "管理登録 1234\n" +
        "NG追加 ○○\nNG一覧\n" +
        "連投制限 数字\n状態確認\n" +
        "挨拶ON / OFF"
      );
    }

    // ===== 管理登録 =====
    if (text.startsWith("管理登録")) {

      const pass = text.replace("管理登録","").trim();

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "admins!A:B"
      });

      const exist = (res.data.values || []).some(r => r[0] === groupId);

      if (exist) return reply(event.replyToken,"既に管理者あり");
      if (pass !== ADMIN_PASS) return reply(event.replyToken,"パス違い");

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "admins!A:C",
        valueInputOption: "RAW",
        requestBody: { values: [[groupId, userId, "初期管理者"]] }
      });

      return reply(event.replyToken,"管理者登録OK");
    }

    // ===== NG追加 =====
    if (text.startsWith("NG追加")) {

      if (!(await isAdmin(groupId, userId))) {
        return reply(event.replyToken,"権限なし");
      }

      const word = text.replace("NG追加","").trim();
      if (!word) return reply(event.replyToken,"入力して");

      await addNG(groupId, word);
      return reply(event.replyToken,"NG追加OK");
    }

    // ===== NG一覧 =====
    if (text === "NG一覧") {
      const list = (await getNG(groupId)).map(r => r[1]);
      return reply(event.replyToken, list.join("\n") || "なし");
    }

    // ===== 連投制限 =====
    if (text.startsWith("連投制限")) {

      const num = text.replace("連投制限","").trim();

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "settings!A:C",
        valueInputOption: "RAW",
        requestBody: { values: [[groupId, num, setting?.[2]]] }
      });

      return reply(event.replyToken,"設定OK");
    }

    // ===== 状態確認 =====
    if (text === "状態確認") {
      return reply(event.replyToken,
        `制限:${setting?.[1]}\n挨拶:${setting?.[2]}`
      );
    }

    // ===== 挨拶 =====
    if (text === "挨拶ON") {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "settings!A:C",
        valueInputOption: "RAW",
        requestBody: { values: [[groupId, setting?.[1], "ON"]] }
      });
      return reply(event.replyToken,"ON");
    }

    if (text === "挨拶OFF") {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "settings!A:C",
        valueInputOption: "RAW",
        requestBody: { values: [[groupId, setting?.[1], "OFF"]] }
      });
      return reply(event.replyToken,"OFF");
    }

  }

  res.sendStatus(200);
});

app.listen(3000);
