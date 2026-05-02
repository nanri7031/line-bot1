import express from "express";
import line from "@line/bot-sdk";
import { google } from "googleapis";

const app = express();

// ================== LINE ==================
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new line.Client(config);

// ================== Google Sheets ==================
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// ================== 管理者 ==================
const OWNER_ID = "U1a1aca9e44466f8cb05003d7dc86fee0";

// ================== 共通関数 ==================
async function getSheet(name) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${name}!A2:B`
  });
  return res.data.values || [];
}

async function addRow(sheet, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A1`, // ←ここ修正済（重要）
    valueInputOption: "RAW",
    requestBody: { values: [values] }
  });
}

async function isAdmin(userId) {
  if (userId === OWNER_ID) return true;
  const rows = await getSheet("admins");
  return rows.some(r => r[0] === userId);
}

// ================== Webhook ==================
app.post("/webhook", line.middleware(config), async (req, res) => {
  Promise.all(req.body.events.map(handleEvent));
  res.status(200).end();
});

// ================== イベント ==================
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text.trim();
  const userId = event.source.userId;

  // ================== PING ==================
  if (text === "ping") {
    return reply(event, "OK");
  }

  // ================== MENU ==================
  if (text === "menu") {
    return replyFlex(event, menuFlex());
  }

  const admin = await isAdmin(userId);

  // ================== NG追加 ==================
  if (text.startsWith("NG追加")) {
    if (!admin) return reply(event, "管理者のみ");

    const word = text.replace("NG追加", "").trim();
    if (!word) return reply(event, "ワード入力して");

    await addRow("ng", [word]);

    return reply(event, `NG追加 OK\n${word}`);
  }

  // ================== NG一覧 ==================
  if (text === "NG一覧") {
    const rows = await getSheet("ng");
    if (rows.length === 0) return reply(event, "NGなし");

    return replyFlex(event, listFlex("NG一覧", rows));
  }

  // ================== 管理一覧 ==================
  if (text === "管理一覧") {
    const rows = await getSheet("admins");
    return replyFlex(event, listFlex("管理一覧", rows));
  }

  // ================== 副管理一覧 ==================
  if (text === "副管理一覧") {
    const rows = await getSheet("subs");
    return replyFlex(event, listFlex("副管理一覧", rows));
  }

  // ================== BAN一覧 ==================
  if (text === "BAN一覧") {
    const rows = await getSheet("ban");
    return replyFlex(event, listFlex("BAN一覧", rows));
  }

  return reply(event, "コマンド未対応");
}

// ================== Flex ==================
function menuFlex() {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        rowBtn("管理一覧","副管理一覧"),
        rowBtn("BAN一覧","NG一覧"),
        rowBtn("管理追加","管理削除"),
        rowBtn("副管理追加","副管理削除"),
        rowBtn("NG追加","通報"),
        rowBtn("BAN解除","状態確認")
      ]
    }
  };
}

function rowBtn(a,b){
  return {
    type:"box",
    layout:"horizontal",
    contents:[
      btn(a),
      btn(b)
    ]
  }
}

function btn(label){
  return {
    type:"button",
    style:"primary",
    action:{type:"message",label,label,text:label}
  }
}

function listFlex(title, rows){
  return {
    type:"bubble",
    body:{
      type:"box",
      layout:"vertical",
      contents:[
        {type:"text",text:title,weight:"bold",size:"lg"},
        ...rows.map(r=>({
          type:"text",
          text:r[1] ? `${r[1]} (${r[0]})` : r[0],
          size:"sm"
        }))
      ]
    }
  };
}

// ================== 返信 ==================
function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: "text",
    text
  });
}

function replyFlex(event, flex) {
  return client.replyMessage(event.replyToken, {
    type: "flex",
    altText: "menu",
    contents: flex
  });
}

// ================== 起動 ==================
app.listen(process.env.PORT || 3000);
