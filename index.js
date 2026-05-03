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

// ===== Google Sheets =====
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.SPREADSHEET_ID;

// ===== 固定設定 =====
const OWNER_ID = "U1a1aca9e44466f8cb05003d7dc86fee0";
const ADMIN_PASS = "1234";

// ===== ヘルパー =====
const reply = (token, text) =>
  client.replyMessage(token, { type: "text", text });

// ===== メンション取得 =====
function getMentionedUserId(event) {
  const m = event.message.mention;
  if (!m || !m.mentionees || m.mentionees.length === 0) return null;
  return m.mentionees[0].userId;
}

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
  let s = await getSettings(groupId);
  if (!s) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "settings!A:C",
      valueInputOption: "RAW",
      requestBody: { values: [[groupId, "5", "ON"]] }
    });
  }
}

// ===== 管理者判定 =====
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

// ===== NGカウント =====
async function getCount(groupId, userId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "log!A:C"
  });
  const rows = res.data.values || [];
  const r = rows.find(x => x[0] === groupId && x[1] === userId);
  return r ? Number(r[2]) : 0;
}

async function addCount(groupId, userId, count) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "log!A:C",
    valueInputOption: "RAW",
    requestBody: { values: [[groupId, userId, count]] }
  });
}

// ===== 連投制限 =====
const spamMap = {};

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req, res) => {

  for (const event of req.body.events) {

    if (!event.source.groupId) continue;

    const groupId = event.source.groupId;
    const userId = event.source.userId;

    await ensureSettings(groupId);
    const setting = await getSettings(groupId);

    // ===== 入室挨拶 =====
    if (event.type === "memberJoined") {
      if (setting?.[2] === "ON") {
        await client.pushMessage(groupId, {
          type: "text",
          text: "ようこそ！"
        });
      }
      continue;
    }

    if (event.type !== "message") continue;
    if (event.message.type !== "text") continue;

    const text = event.message.text.trim();

    // ===== 連投制限 =====
    const now = Date.now();
    if (!spamMap[userId]) spamMap[userId] = [];
    spamMap[userId] = spamMap[userId].filter(t => now - t < 5000);
    spamMap[userId].push(now);

    if (spamMap[userId].length > Number(setting?.[1] || 5)) {
      await reply(event.replyToken, "⚠️連投制限");
      continue;
    }

    // ===== NG検知 =====
    const ngList = await getNG(groupId);
    const hit = ngList.find(r => text.includes(r[1]));

    if (hit) {
      let c = await getCount(groupId, userId);
      c++;

      await addCount(groupId, userId, c);

      await reply(event.replyToken, `⚠️NGワード ${c}回目`);

      if (c >= 3) {
        await client.kickMember(groupId, userId);
      }
      continue;
    }

    // ===== メニュー =====
    if (text === "menu") {
      return reply(event.replyToken,
        "管理メニュー\n" +
        "管理登録 1234\n管理追加 @\n管理削除 @\n" +
        "NG追加 ○○\nNG一覧\n" +
        "連投制限 数字\n状態確認\n" +
        "挨拶ON / OFF / 確認"
      );
    }

    // ===== 初回管理登録 =====
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

    // ===== 管理追加 =====
    if (text.startsWith("管理追加")) {

      if (!(await isAdmin(groupId, userId))) {
        return reply(event.replyToken,"権限なし");
      }

      const target = getMentionedUserId(event);
      if (!target) return reply(event.replyToken,"メンションして");

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "admins!A:C",
        valueInputOption: "RAW",
        requestBody: { values: [[groupId, target, ""]] }
      });

      return reply(event.replyToken,"追加OK");
    }

    // ===== 管理削除 =====
    if (text.startsWith("管理削除")) {

      if (!(await isAdmin(groupId, userId))) {
        return reply(event.replyToken,"権限なし");
      }

      const target = getMentionedUserId(event);
      if (!target) return reply(event.replyToken,"メンションして");

      if (target === OWNER_ID) {
        return reply(event.replyToken,"オーナー削除不可");
      }

      return reply(event.replyToken,"削除処理はシート側で");
    }

    // ===== NG追加 =====
    if (text.startsWith("NG追加")) {
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

    // ===== 連投制限設定 =====
    if (text.startsWith("連投制限")) {
      const num = text.replace("連投制限","").trim();

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "settings!A:C",
        valueInputOption: "RAW",
        requestBody: { values: [[groupId, num, setting?.[2]]] }
      });

      return reply(event.replyToken, "設定OK");
    }

    // ===== 状態確認 =====
    if (text === "状態確認") {
      return reply(event.replyToken,
        `制限:${setting?.[1]}\n挨拶:${setting?.[2]}`
      );
    }

    // ===== 挨拶 =====
    if (text === "挨拶ON") {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "settings!A:C",
        valueInputOption: "RAW",
        requestBody: { values: [[groupId, setting?.[1], "ON"]] }
      });
      return reply(event.replyToken,"ON");
    }

    if (text === "挨拶OFF") {
      await sheets.spreadsheets.values.update({
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
