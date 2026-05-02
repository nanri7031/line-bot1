import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import { google } from "googleapis";

const app = express();

/* ===============================
   LINE設定
=============================== */
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const client = new Client(config);

/* ===============================
   OWNER（あなた）
=============================== */
const OWNER_ID = "U1a1aca9e44466f8cb05003d7dc86fee0";

/* ===============================
   Google Sheets
=============================== */
const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
creds.private_key = creds.private_key.replace(/\\n/g, "\n");

const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

/* ===============================
   共通関数
=============================== */
async function getRows(sheet) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheet}!A:B`,
    });
    return res.data.values || [];
  } catch {
    return [];
  }
}

async function addRow(sheet, row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A:A`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

async function removeRow(sheet, id) {
  const rows = await getRows(sheet);
  const newRows = rows.filter(r => r[0] !== id);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: newRows },
  });
}

async function isAdmin(userId) {
  const rows = await getRows("admins");
  return rows.some(r => r[0] === userId) || userId === OWNER_ID;
}

/* ===============================
   Flex UI
=============================== */
function btn(label, text, red = false) {
  return {
    type: "button",
    style: red ? "primary" : "secondary",
    color: red ? "#ff3b30" : "#3b82f6",
    action: { type: "message", label, text },
  };
}

function row(a, b) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    contents: [a, b],
  };
}

/* ===== メニュー（全部入り） ===== */
function menuFlex() {
  return {
    type: "flex",
    altText: "menu",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          row(btn("管理一覧", "管理一覧"), btn("副管理一覧", "副管理一覧")),
          row(btn("BAN一覧", "BAN一覧"), btn("NG一覧", "NG一覧")),
          row(btn("管理追加", "管理追加 @"), btn("管理削除", "管理削除 @")),
          row(btn("副管理追加", "副管理追加 @"), btn("副管理削除", "副管理削除 @")),
          row(btn("NG追加", "NG追加 "), btn("通報→BAN", "通報 @", true)),
          row(btn("BAN解除", "解除 @", true), btn("状態確認", "ping")),
          row(btn("連投制限", "連投制限"), btn("挨拶ON", "挨拶ON")),
          row(btn("挨拶OFF", "挨拶OFF"), btn("挨拶確認", "挨拶確認")),
        ],
      },
    },
  };
}

/* ===== 管理一覧Flex ===== */
function adminFlex(rows) {
  return {
    type: "flex",
    altText: "管理一覧",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "管理一覧", weight: "bold", size: "lg" },
          ...rows.map(r => ({
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: r[1] || r[0], flex: 3 },
              {
                type: "button",
                style: "secondary",
                color: "#ff4444",
                action: {
                  type: "message",
                  label: "削除",
                  text: "管理削除 " + r[0],
                },
                flex: 1,
              },
            ],
          })),
        ],
      },
    },
  };
}

/* ===== NG一覧Flex ===== */
function ngFlex(rows) {
  return {
    type: "flex",
    altText: "NG一覧",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "NG一覧", weight: "bold", size: "lg" },
          ...rows.map(r => ({
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: r[0], flex: 3 },
              {
                type: "button",
                style: "secondary",
                color: "#ff4444",
                action: {
                  type: "message",
                  label: "削除",
                  text: "NG削除 " + r[0],
                },
                flex: 1,
              },
            ],
          })),
        ],
      },
    },
  };
}

/* ===============================
   Webhook
=============================== */
app.post("/webhook", middleware(config), async (req, res) => {
  await Promise.all(req.body.events.map(handleEvent));
  res.sendStatus(200);
});

/* ===============================
   メイン処理
=============================== */
async function handleEvent(event) {
  try {
    if (event.type === "memberJoined") {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "参加ありがとう！",
      });
    }

    if (event.type !== "message" || event.message.type !== "text") return;

    const text = event.message.text.trim();
    const userId = event.source.userId;

    /* 基本 */
    if (text === "ping") {
      return client.replyMessage(event.replyToken, { type: "text", text: "OK" });
    }

    if (text === "menu") {
      return client.replyMessage(event.replyToken, menuFlex());
    }

    const admin = await isAdmin(userId);

    let targetId = null;
    if (event.message.mention) {
      targetId = event.message.mention.mentionees[0].userId;
    }

    /* NG追加 */
    if (text.startsWith("NG追加") && admin) {
      const word = text.replace("NG追加", "").trim();
      if (!word) {
        return client.replyMessage(event.replyToken, { type: "text", text: "ワード入力して" });
      }
      await addRow("ng", [word]);
      return client.replyMessage(event.replyToken, { type: "text", text: "NG追加OK" });
    }

    /* 管理追加 */
    if (text.startsWith("管理追加") && admin && targetId) {
      const profile = await client.getProfile(targetId);
      await addRow("admins", [targetId, profile.displayName]);
      return client.replyMessage(event.replyToken, { type: "text", text: "管理追加OK" });
    }

    /* 管理一覧 */
    if (text === "管理一覧") {
      const rows = await getRows("admins");
      return client.replyMessage(event.replyToken, adminFlex(rows));
    }

    /* NG一覧 */
    if (text === "NG一覧") {
      const rows = await getRows("ng");
      return client.replyMessage(event.replyToken, ngFlex(rows));
    }

    /* 削除 */
    if (text.startsWith("管理削除 ")) {
      const id = text.replace("管理削除 ", "");
      await removeRow("admins", id);
      return client.replyMessage(event.replyToken, { type: "text", text: "削除OK" });
    }

    if (text.startsWith("NG削除 ")) {
      const word = text.replace("NG削除 ", "");
      await removeRow("ng", word);
      return client.replyMessage(event.replyToken, { type: "text", text: "削除OK" });
    }

    /* 通報BAN */
    if (text.startsWith("通報") && admin && targetId) {
      await addRow("ban", [targetId]);
      return client.replyMessage(event.replyToken, { type: "text", text: "BAN完了" });
    }

    /* BAN解除 */
    if (text.startsWith("解除") && admin && targetId) {
      await removeRow("ban", targetId);
      return client.replyMessage(event.replyToken, { type: "text", text: "解除OK" });
    }

  } catch (err) {
    console.log("エラー:", err);
  }
}

/* ===============================
   起動
=============================== */
app.listen(3000, () => console.log("起動OK"));
