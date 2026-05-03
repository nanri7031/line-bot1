import express from "express";
import line from "@line/bot-sdk";
import { google } from "googleapis";

const app = express();

// ===== LINE =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

// ===== Google Sheets =====
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// ===== 管理者 =====
const OWNER_ID = "U1a1aca9e44466f8cb05003d7dc86fee0";

// ===== ヘルパー =====
const isAdmin = (userId) => userId === OWNER_ID;

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then(() => res.json({ success: true }))
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

// ===== イベント処理 =====
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text.trim();
  const userId = event.source.userId;

  // ===== ping =====
  if (text === "ping") {
    return reply(event.replyToken, "OK");
  }

  // ===== menu =====
  if (text === "menu") {
    return reply(event.replyToken, menuFlex());
  }

  // ===== 管理者のみ =====
  if (!isAdmin(userId)) return;

  // ===== NG追加 =====
  if (text.startsWith("NG追加")) {
    const word = text.replace("NG追加", "").trim();
    if (!word) return reply(event.replyToken, "ワード入力して");

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "ng!A2:A",
      valueInputOption: "RAW",
      requestBody: { values: [[word]] }
    });

    return reply(event.replyToken, `${word} を追加しました`);
  }

  // ===== NG一覧 =====
  if (text === "NG一覧") {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "ng!A2:A"
    });

    const list = res.data.values || [];
    if (list.length === 0) {
      return reply(event.replyToken, "NGなし");
    }

    return reply(event.replyToken, ngFlex(list));
  }

  return reply(event.replyToken, "コマンド未対応");
}

// ===== 返信 =====
function reply(token, message) {
  return client.replyMessage(token, message);
}

// ===== メニューFlex =====
function menuFlex() {
  return {
    type: "flex",
    altText: "メニュー",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          btn("管理一覧"), btn("副管理一覧"),
          btn("BAN一覧"), btn("NG一覧"),
          btn("管理追加"), btn("管理削除"),
          btn("副管理追加"), btn("副管理削除"),
          btn("NG追加"), btn("通報"),
          btn("解除"), btn("状態確認"),
          btn("連投制限"), btn("挨拶ON"),
          btn("挨拶OFF"), btn("挨拶確認")
        ]
      }
    }
  };
}

// ===== ボタン =====
function btn(label) {
  return {
    type: "button",
    style: "primary",
    margin: "sm",
    action: {
      type: "message",
      label: label,
      text: label
    }
  };
}

// ===== NG一覧Flex =====
function ngFlex(list) {
  return {
    type: "flex",
    altText: "NG一覧",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: list.map(item => ({
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: item[0],
              size: "sm",
              flex: 3
            },
            {
              type: "button",
              style: "secondary",
              height: "sm",
              action: {
                type: "message",
                label: "削除",
                text: `NG削除 ${item[0]}`
              }
            }
          ]
        }))
      }
    }
  };
}

// ===== 起動 =====
app.listen(process.env.PORT || 3000);
