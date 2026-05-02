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
   Google Sheets
=============================== */
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

/* ===============================
   安全版 共通関数（落ちない）
=============================== */
async function getList(sheet) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheet}!A1:A`,
    });
    return res.data.values ? res.data.values.flat() : [];
  } catch (e) {
    console.log("getList error:", sheet, e.message);
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
    console.log("add error:", sheet, e.message);
  }
}

async function remove(sheet, value) {
  try {
    const list = await getList(sheet);
    const newList = list.filter(v => v !== value);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheet}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: newList.map(v => [v]),
      },
    });
  } catch (e) {
    console.log("remove error:", sheet, e.message);
  }
}

/* ===============================
   メニューUI（青/赤）
=============================== */
function btn(label, text, danger = false) {
  return {
    type: "button",
    style: "primary",
    color: danger ? "#ff4444" : "#3399ff",
    action: { type: "message", label, text },
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
        spacing: "sm",
        contents: [
          btn("管理一覧", "管理一覧"),
          btn("副管理一覧", "副管理一覧"),
          btn("BAN一覧", "BAN一覧"),
          btn("NG一覧", "NG一覧"),
          btn("管理追加", "管理追加 @"),
          btn("管理削除", "管理削除 @"),
          btn("副管理追加", "副管理追加 @"),
          btn("副管理削除", "副管理削除 @"),
          btn("NG追加", "NG追加 "),
          btn("通報→BAN", "通報 @", true),
          btn("BAN解除", "解除 @", true),
          btn("状態確認", "ping"),
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
   メイン処理（絶対落ちない）
=============================== */
async function handleEvent(event) {
  try {
    console.log("event:", JSON.stringify(event));

    if (event.type === "follow") {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "追加ありがとう！menuで操作",
      });
    }

    if (event.type === "memberJoined") {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "参加ありがとう！",
      });
    }

    if (event.type !== "message" || event.message.type !== "text") return;

    const text = event.message.text.trim();
    const userId = event.source.userId;

    /* ===== 最優先（必ず返る） ===== */
    if (text === "ping") {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "OK",
      });
    }

    if (text === "menu") {
      return client.replyMessage(event.replyToken, menuFlex());
    }

    /* ===== BANチェック ===== */
    const banList = await getList("ban");
    if (banList.includes(userId)) return;

    /* ===== NG検知 ===== */
    const ngList = await getList("ng");
    if (ngList.some(word => text.includes(word))) {
      await add("ban", userId);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "NG検知 → BAN",
      });
    }

    /* ===== NG追加 ===== */
    if (text.startsWith("NG追加 ")) {
      const word = text.replace("NG追加 ", "");
      await add("ng", word);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "NG追加OK",
      });
    }

    /* ===== 一覧 ===== */
    if (text === "NG一覧") {
      const list = await getList("ng");
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: list.join("\n") || "なし",
      });
    }

    if (text === "BAN一覧") {
      const list = await getList("ban");
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: list.join("\n") || "なし",
      });
    }

    if (text === "管理一覧") {
      const list = await getList("admins");
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: list.join("\n") || "なし",
      });
    }

    if (text === "副管理一覧") {
      const list = await getList("subs");
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: list.join("\n") || "なし",
      });
    }

    /* ===== 解除 ===== */
    if (text.startsWith("解除 ")) {
      const id = text.replace("解除 ", "");
      await remove("ban", id);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "解除OK",
      });
    }

  } catch (err) {
    console.log("🔥致命エラー:", err);

    try {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "内部エラー（ログ確認）",
      });
    } catch {}
  }
}

/* ===============================
   起動
=============================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("起動OK"));
