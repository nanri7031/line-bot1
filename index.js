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
    console.log("add error:", e.message);
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
    console.log("remove error:", e.message);
  }
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
    spacing: "sm",
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
        spacing: "sm",
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
   メイン（完全安定版）
=============================== */
async function handleEvent(event) {
  try {
    if (event.type !== "message" || event.message.type !== "text") return;

    const text = event.message.text.trim();
    const userId = event.source.userId;

    console.log("受信:", text);

    /* ===== ping ===== */
    if (text === "ping") {
      return client.replyMessage(event.replyToken, { type: "text", text: "OK" });
    }

    /* ===== menu ===== */
    if (text === "menu") {
      return client.replyMessage(event.replyToken, menuFlex());
    }

    /* ===== BAN ===== */
    const banList = await getList("ban");
    if (banList.includes(userId)) return;

    /* ===== NG検知 ===== */
    const ngList = await getList("ng");
    if (ngList.some(w => text.includes(w))) {
      await add("ban", userId);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "NG検知→BAN",
      });
    }

    /* ===== NG追加 ===== */
    if (text.startsWith("NG追加")) {
      const word = text.replace("NG追加", "").trim();
      if (!word) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "NGワード入力して",
        });
      }
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

    /* ===== 管理追加 ===== */
    if (text.startsWith("管理追加")) {
      const id = text.split("@")[1];
      if (!id) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "IDを@付きで送って",
        });
      }
      await add("admins", id);
      return client.replyMessage(event.replyToken, { type: "text", text: "追加OK" });
    }

    /* ===== 管理削除 ===== */
    if (text.startsWith("管理削除")) {
      const id = text.split("@")[1];
      if (!id) return;
      await remove("admins", id);
      return client.replyMessage(event.replyToken, { type: "text", text: "削除OK" });
    }

    /* ===== 副管理追加 ===== */
    if (text.startsWith("副管理追加")) {
      const id = text.split("@")[1];
      if (!id) return;
      await add("subs", id);
      return client.replyMessage(event.replyToken, { type: "text", text: "追加OK" });
    }

    /* ===== 副管理削除 ===== */
    if (text.startsWith("副管理削除")) {
      const id = text.split("@")[1];
      if (!id) return;
      await remove("subs", id);
      return client.replyMessage(event.replyToken, { type: "text", text: "削除OK" });
    }

    /* ===== 通報BAN ===== */
    if (text.startsWith("通報")) {
      const id = text.split("@")[1];
      if (!id) return;
      await add("ban", id);
      return client.replyMessage(event.replyToken, { type: "text", text: "BAN完了" });
    }

    /* ===== BAN解除 ===== */
    if (text.startsWith("解除")) {
      const id = text.split("@")[1];
      if (!id) return;
      await remove("ban", id);
      return client.replyMessage(event.replyToken, { type: "text", text: "解除OK" });
    }

    /* ===== fallback ===== */
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "コマンド未対応",
    });

  } catch (err) {
    console.log("🔥エラー:", err);
  }
}

/* ===============================
   起動
=============================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("起動OK"));
