import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import { google } from "googleapis";

const app = express();

// ===== LINE =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const client = new Client(config);

// ===== Google =====
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.SPREADSHEET_ID;

// ===== 管理者 =====
const OWNER = "U1a1aca9e44466f8cb05003d7dc86fee0";

// ===== userId取得 =====
async function getUserId(event) {
  return event.source.userId;
}

// ===== 管理者判定 =====
async function isAdmin(userId) {
  if (userId === OWNER) return true;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "admins!A:A",
  });

  const rows = res.data.values || [];
  return rows.some(r => r[0] === userId);
}

// ===== 共通 =====
async function get(sheet) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheet}!A:B`,
  });
  return res.data.values || [];
}

async function add(sheet, row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheet}!A:B`,
    valueInputOption: "RAW",
    resource: { values: [row] },
  });
}

async function remove(sheet, value) {
  const rows = await get(sheet);
  const filtered = rows.filter(r => r[0] !== value);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheet}!A:B`,
  });

  if (filtered.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheet}!A:B`,
      valueInputOption: "RAW",
      resource: { values: filtered },
    });
  }
}

// ===== メニュー（2列・色分け）=====
function menu() {
  const rows = [
    ["管理一覧","副管理一覧","blue"],
    ["BAN一覧","NG一覧","blue"],
    ["管理追加","管理削除","light"],
    ["副管理追加","副管理削除","light"],
    ["NG追加","通報","danger"],
    ["解除","状態確認","dark"],
    ["連投制限","挨拶ON","light"],
    ["挨拶OFF","挨拶確認","light"]
  ];

  return {
    type: "flex",
    altText: "管理メニュー",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type:"text", text:"管理メニュー", weight:"bold", size:"lg", align:"center" },
          ...rows.map(r=>({
            type:"box",
            layout:"horizontal",
            contents:[
              btn(r[0], r[2]),
              btn(r[1], r[2])
            ]
          }))
        ]
      }
    }
  };
}

function btn(label,type){
  let color="#3B82F6";
  if(type==="blue") color="#2563EB";
  if(type==="light") color="#60A5FA";
  if(type==="danger") color="#EF4444";
  if(type==="dark") color="#374151";

  return {
    type:"button",
    style:"primary",
    color,
    flex:1,
    action:{ type:"message", label, text:label }
  };
}

// ===== 一覧Flex =====
function listFlex(title, list, cmd) {
  return {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: title, weight: "bold" },
          ...list.map(r => ({
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: r[1] || r[0], flex: 3 },
              {
                type: "button",
                style: "secondary",
                action: {
                  type: "message",
                  label: "削除",
                  text: `${cmd} ${r[0]}`
                }
              }
            ]
          }))
        ]
      }
    }
  };
}

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req, res) => {
  for (const event of req.body.events) {
    if (event.type !== "message") continue;

    const text = event.message.text.trim();
    const userId = await getUserId(event);

    // menu
    if (text === "menu") {
      await client.replyMessage(event.replyToken, menu());
      continue;
    }

    // 管理者制限
    if (!(await isAdmin(userId))) continue;

    // ping
    if (text === "ping") {
      await client.replyMessage(event.replyToken,{type:"text",text:"OK"});
    }

    // ===== 一覧 =====
    if (text === "管理一覧")
      await client.replyMessage(event.replyToken, listFlex("管理一覧", await get("admins"), "管理削除"));

    if (text === "副管理一覧")
      await client.replyMessage(event.replyToken, listFlex("副管理一覧", await get("subs"), "副管理削除"));

    if (text === "NG一覧")
      await client.replyMessage(event.replyToken, listFlex("NG一覧", await get("ng"), "NG削除"));

    if (text === "BAN一覧")
      await client.replyMessage(event.replyToken, listFlex("BAN一覧", await get("ban"), "解除"));

    // ===== 追加 =====
    if (text.startsWith("NG追加")) {
      const w = text.replace("NG追加","").trim();
      await add("ng",[w]);
      await client.replyMessage(event.replyToken,{type:"text",text:"NG追加OK"});
    }

    if (text.startsWith("副管理追加")) {
      const name = text.replace("副管理追加","").trim();
      await add("subs",[Date.now(),name]);
      await client.replyMessage(event.replyToken,{type:"text",text:"副管理追加OK"});
    }

    // ===== 削除 =====
    if (text.startsWith("NG削除")) {
      const w = text.replace("NG削除","").trim();
      await remove("ng", w);
      await client.replyMessage(event.replyToken,{type:"text",text:"削除OK"});
    }

    if (text.startsWith("副管理削除")) {
      const id = text.replace("副管理削除","").trim();
      await remove("subs", id);
      await client.replyMessage(event.replyToken,{type:"text",text:"削除OK"});
    }

    // ===== 連投制限 =====
    if (text.startsWith("連投制限")) {
      const num = text.replace("連投制限","").trim();
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "settings!A1",
        valueInputOption: "RAW",
        resource: { values: [[num]] }
      });
      await client.replyMessage(event.replyToken,{type:"text",text:"設定OK"});
    }
  }
  res.sendStatus(200);
});

app.listen(3000);
