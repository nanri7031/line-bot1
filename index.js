import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import { google } from "googleapis";

const app = express();

// ===== LINE設定 =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const client = new Client(config);

// ===== Google Sheets設定 =====
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.SPREADSHEET_ID;

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req, res) => {
  Promise.all(req.body.events.map(handleEvent));
  res.sendStatus(200);
});

// ===== メイン処理 =====
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text;

  const reply = (msg) =>
    client.replyMessage(event.replyToken, {
      type: "text",
      text: msg,
    });

  // =========================
  // メニュー
  // =========================
  if (text === "menu") {
    return client.replyMessage(event.replyToken, {
      type: "flex",
      altText: "管理メニュー",
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: "管理メニュー",
              weight: "bold",
              size: "lg",
              align: "center",
            },
            ...[
              "管理一覧",
              "副管理一覧",
              "BAN一覧",
              "NG一覧",
              "管理追加",
              "管理削除",
              "副管理追加",
              "副管理削除",
              "NG追加",
              "通報",
              "解除",
              "状態確認",
              "連投制限",
              "挨拶ON",
              "挨拶OFF",
              "挨拶確認",
            ].map((label) => ({
              type: "button",
              style:
                label.includes("BAN") || label.includes("NG追加")
                  ? "primary"
                  : label === "解除"
                  ? "secondary"
                  : "link",
              action: {
                type: "message",
                label,
                text: label,
              },
            })),
          ],
        },
      },
    });
  }

  // =========================
  // NG追加
  // =========================
  if (text.startsWith("NG追加")) {
    const word = text.replace("NG追加", "").trim();
    if (!word) return reply("ワード入力して");

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "ng!A:A",
      valueInputOption: "RAW",
      resource: {
        values: [[word]],
      },
    });

    return reply("NG追加 OK");
  }

  // =========================
  // NG一覧
  // =========================
  if (text === "NG一覧") {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "ng!A:A",
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return reply("NGなし");

    const list = rows.slice(1).map((r) => r[0]).join("\n");
    return reply(`NG一覧\n${list}`);
  }

  // =========================
  // 副管理追加
  // =========================
  if (text.startsWith("副管理追加")) {
    const name = text.replace("副管理追加", "").trim();
    if (!name) return reply("名前入力して");

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "subs!A:B",
      valueInputOption: "RAW",
      resource: {
        values: [[Date.now(), name]],
      },
    });

    return reply("副管理追加OK");
  }

  // =========================
  // 副管理一覧
  // =========================
  if (text === "副管理一覧") {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "subs!B:B",
    });

    const rows = res.data.values || [];
    if (rows.length === 0) return reply("副管理なし");

    const list = rows.map((r) => r[0]).join("\n");
    return reply(`副管理一覧\n${list}`);
  }

  // =========================
  // 連投制限
  // =========================
  if (text.startsWith("連投制限")) {
    const num = text.replace("連投制限", "").trim();
    if (!num || isNaN(num)) return reply("数字入れて");

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "settings!A1",
      valueInputOption: "RAW",
      resource: {
        values: [[num]],
      },
    });

    return reply(`連投制限 ${num}`);
  }

  // =========================
  // ping確認
  // =========================
  if (text === "ping") {
    return reply("OK");
  }
}

// ===== 起動 =====
app.listen(process.env.PORT || 3000);
