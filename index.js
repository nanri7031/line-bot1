import express from "express";
import * as line from "@line/bot-sdk";
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

// ===== 設定 =====
const OWNER = "U1a1aca9e44466f8cb05003d7dc86fee0";

// ===== 共通 =====
const get = async (name) => {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${name}!A2:B`
  });
  return r.data.values || [];
};

const add = async (name, row) => {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${name}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [row] }
  });
};

const del = async (name, value) => {
  const rows = await get(name);
  const filtered = rows.filter(r => r[0] !== value);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${name}!A2:B`
  });

  if (filtered.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${name}!A2`,
      valueInputOption: "RAW",
      requestBody: { values: filtered }
    });
  }
};

const isAdmin = async (id) => {
  if (id === OWNER) return true;
  const admins = await get("admins");
  const subs = await get("subs");
  return [...admins, ...subs].some(r => r[0] === id);
};

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  await Promise.all(req.body.events.map(handle));
  res.sendStatus(200);
});

// ===== メイン処理 =====
async function handle(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text.trim();
  const userId = event.source.userId;
  const admin = await isAdmin(userId);

  // ===== ping =====
  if (text === "ping") return reply(event, "OK");

  // ===== menu =====
  if (text === "menu") return replyFlex(event, menu());

  // ===== NG追加 =====
  if (text.startsWith("NG追加")) {
    if (!admin) return reply(event, "管理者のみ");

    const word = text.replace("NG追加", "").trim();
    if (!word) return reply(event, "ワード入力して");

    await add("ng", [word]);
    return reply(event, `NG追加 OK\n${word}`);
  }

  // ===== NG一覧 =====
  if (text === "NG一覧") {
    const rows = await get("ng");
    return replyFlex(event, list("NG一覧", rows, "NG削除"));
  }

  // ===== NG削除 =====
  if (text.startsWith("NG削除")) {
    const w = text.replace("NG削除", "").trim();
    await del("ng", w);
    return reply(event, `削除 OK\n${w}`);
  }

  // ===== 管理追加 =====
  if (text.startsWith("管理追加")) {
    if (!admin) return reply(event, "管理者のみ");
    const m = event.message.mention?.mentionees?.[0];
    if (!m) return reply(event, "@指定して");
    await add("admins", [m.userId, "管理者"]);
    return reply(event, "管理者追加 OK");
  }

  // ===== 副管理追加 =====
  if (text.startsWith("副管理追加")) {
    if (!admin) return reply(event, "管理者のみ");
    const m = event.message.mention?.mentionees?.[0];
    if (!m) return reply(event, "@指定して");
    await add("subs", [m.userId, "副管理"]);
    return reply(event, "副管理追加 OK");
  }

  // ===== 通報→BAN =====
  if (text.startsWith("通報")) {
    if (!admin) return reply(event, "管理者のみ");
    const m = event.message.mention?.mentionees?.[0];
    if (!m) return reply(event, "@指定して");
    await add("ban", [m.userId]);
    return reply(event, "BAN完了");
  }

  // ===== BAN解除 =====
  if (text.startsWith("解除")) {
    const m = event.message.mention?.mentionees?.[0];
    if (!m) return reply(event, "@指定して");
    await del("ban", m.userId);
    return reply(event, "BAN解除 OK");
  }

  // ===== 管理一覧 =====
  if (text === "管理一覧") {
    return replyFlex(event, list("管理一覧", await get("admins"), "管理削除"));
  }

  // ===== 副管理一覧 =====
  if (text === "副管理一覧") {
    return replyFlex(event, list("副管理一覧", await get("subs"), "副管理削除"));
  }

  // ===== BAN一覧 =====
  if (text === "BAN一覧") {
    return replyFlex(event, list("BAN一覧", await get("ban"), "解除"));
  }

  // ===== 連投制限 =====
  if (text.startsWith("連投制限")) {
    const num = text.replace("連投制限","").trim();
    await add("settings", ["limit", num]);
    return reply(event, "設定OK");
  }

  return;
}

// ===== Flex UI =====
const menu = () => ({
  type: "bubble",
  body: {
    type: "box",
    layout: "vertical",
    contents: [
      row("管理一覧","副管理一覧"),
      row("BAN一覧","NG一覧"),
      row("管理追加","管理削除"),
      row("副管理追加","副管理削除"),
      row("NG追加","通報"),
      row("解除","状態確認"),
      row("連投制限","挨拶ON"),
      row("挨拶OFF","挨拶確認")
    ]
  }
});

const row = (a,b)=>({
  type:"box",
  layout:"horizontal",
  contents:[btn(a),btn(b)]
});

const btn = (t)=>({
  type:"button",
  style:"primary",
  action:{type:"message",label:t,text:t}
});

const list = (title, rows, delCmd)=>({
  type:"bubble",
  body:{
    type:"box",
    layout:"vertical",
    contents:[
      {type:"text",text:title,weight:"bold"},
      ...rows.map(r=>({
        type:"box",
        layout:"horizontal",
        contents:[
          {type:"text",text:r[0],flex:4},
          {
            type:"button",
            style:"secondary",
            action:{
              type:"message",
              label:"削除",
              text:`${delCmd} ${r[0]}`
            }
          }
        ]
      }))
    ]
  }
});

// ===== 返信 =====
const reply = (e,t)=>client.replyMessage(e.replyToken,{type:"text",text:t});
const replyFlex = (e,f)=>client.replyMessage(e.replyToken,{type:"flex",altText:"menu",contents:f});

// ===== 起動 =====
app.listen(process.env.PORT || 3000);
