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
   共通関数
=============================== */

// 読み込み
async function getColumn(sheet) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A1:A`,
  });
  return res.data.values ? res.data.values.flat() : [];
}

// 追加
async function addRow(sheet, value) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[value]],
    },
  });
}

// 削除
async function removeRow(sheet, value) {
  const list = await getColumn(sheet);
  const filtered = list.filter(v => v !== value);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: filtered.map(v => [v]),
    },
  });
}

/* ===============================
   メニューUI（2列）
=============================== */
function menuFlex() {
  return {
    type: "flex",
    altText: "メニュー",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          button("管理一覧", "管理一覧"),
          button("副管理一覧", "副管理一覧"),
          button("BAN一覧", "BAN一覧"),
          button("NG一覧", "NG一覧"),
          button("管理追加", "管理追加 @"),
          button("管理削除", "管理削除 @"),
          button("副管理追加", "副管理追加 @"),
          button("副管理削除", "副管理削除 @"),
          button("NG追加", "NG追加 "),
          button("通報", "通報 @"),
          button("BAN解除", "解除 @"),
          button("状態確認", "ping"),
        ],
      },
    },
  };
}

function button(label, text) {
  return {
    type: "button",
    style: "primary",
    color: label.includes("BAN") || label.includes("通報") ? "#ff4444" : "#3399ff",
    action: {
      type: "message",
      label,
      text,
    },
  };
}

/* ===============================
   メイン処理
=============================== */
app.post("/webhook", middleware(config), async (req, res) => {
  Promise.all(req.body.events.map(handleEvent));
  res.sendStatus(200);
});

async function handleEvent(event) {
  if (event.type === "follow") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "友達追加ありがとう！ menu と送ってね",
    });
  }

  if (event.type === "memberJoined") {
    await client.replyMessage(event.replyToken, {
      type: "text",
      text: "参加ありがとう！よろしく！",
    });
  }

  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text.trim();
  const userId = event.source.userId;

  /* ===== NG検知 ===== */
  const ngList = await getColumn("ng");
  if (ngList.some(word => text.includes(word))) {
    await addRow("ban", userId);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "NG検知 → BAN",
    });
  }

  /* ===== BAN済み ===== */
  const banList = await getColumn("ban");
  if (banList.includes(userId)) return;

  /* ===== コマンド ===== */

  if (text === "menu") {
    return client.replyMessage(event.replyToken, menuFlex());
  }

  if (text === "ping") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "BOT正常稼働中",
    });
  }

  if (text.startsWith("NG追加 ")) {
    const word = text.replace("NG追加 ", "");
    await addRow("ng", word);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `NG追加: ${word}`,
    });
  }

  if (text === "NG一覧") {
    const list = await getColumn("ng");
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: list.join("\n") || "なし",
    });
  }

  if (text === "BAN一覧") {
    const list = await getColumn("ban");
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: list.join("\n") || "なし",
    });
  }

  if (text.startsWith("解除 ")) {
    const id = text.replace("解除 ", "");
    await removeRow("ban", id);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "BAN解除",
    });
  }

  if (text === "管理一覧") {
    const list = await getColumn("admins");
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: list.join("\n") || "なし",
    });
  }

  if (text === "副管理一覧") {
    const list = await getColumn("subs");
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: list.join("\n") || "なし",
    });
  }
}

/* ===============================
   起動
=============================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("起動OK"));
