import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import { google } from "googleapis";

const app = express();

/* ===============================
   LINE
=============================== */
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const client = new Client(config);

/* ===============================
   ★ 固定管理者（あなた）
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
   共通
=============================== */
async function getList(sheet) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheet}!A1:A1000`,
    });
    return res.data.values ? res.data.values.flat() : [];
  } catch {
    return [];
  }
}

async function add(sheet, value) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheet}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [[value]] },
    });
  } catch (e) {
    console.log(e.message);
  }
}

/* ===============================
   管理者チェック
=============================== */
async function isAdmin(userId) {
  const admins = await getList("admins");
  return admins.includes(userId) || userId === OWNER_ID;
}

/* ===============================
   UI（2列）
=============================== */
function btn(label, text, danger = false) {
  return {
    type: "button",
    style: "primary",
    color: danger ? "#ff4444" : "#3399ff",
    action: { type: "message", label, text },
  };
}

function row(a, b) {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "box", layout: "vertical", contents: [a], flex: 1 },
      { type: "box", layout: "vertical", contents: [b], flex: 1 },
    ],
  };
}

function menuFlex() {
  return {
    type: "flex",
    altText: "menu",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          row(btn("管理一覧", "管理一覧"), btn("副管理一覧", "副管理一覧")),
          row(btn("BAN一覧", "BAN一覧"), btn("NG一覧", "NG一覧")),
          row(btn("管理追加", "管理追加 @"), btn("管理削除", "管理削除 @")),
          row(btn("副管理追加", "副管理追加 @"), btn("副管理削除", "副管理削除 @")),
          row(btn("NG追加", "NG追加 test"), btn("通報→BAN", "通報 @", true)),
          row(btn("BAN解除", "解除 @", true), btn("状態確認", "ping")),
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
   メイン
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

    const text = event.message.text;
    const userId = event.source.userId;

    /* ===== 基本 ===== */
    if (text === "ping") {
      return client.replyMessage(event.replyToken, { type: "text", text: "OK" });
    }

    if (text === "menu") {
      return client.replyMessage(event.replyToken, menuFlex());
    }

    /* ===== 管理者チェック ===== */
    const admin = await isAdmin(userId);

    /* ===== メンション取得 ===== */
    let targetId = null;
    if (event.message.mention) {
      targetId = event.message.mention.mentionees[0].userId;
    }

    /* ===== NG追加 ===== */
    if (text.startsWith("NG追加")) {
      if (!admin) return;
      const word = text.replace("NG追加", "").trim();
      if (!word) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "NGワード入れて",
        });
      }
      await add("ng", word);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "NG追加OK",
      });
    }

    /* ===== 管理追加 ===== */
    if (text.startsWith("管理追加")) {
      if (!admin) return;
      if (!targetId) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "@で指定して",
        });
      }
      await add("admins", targetId);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "管理追加OK",
      });
    }

    /* ===== 通報 ===== */
    if (text.startsWith("通報")) {
      if (!admin) return;
      if (!targetId) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "@で指定して",
        });
      }
      await add("ban", targetId);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "BAN完了",
      });
    }

  } catch (e) {
    console.log(e);
  }
}

/* ===============================
   起動
=============================== */
app.listen(3000, () => console.log("起動OK"));
