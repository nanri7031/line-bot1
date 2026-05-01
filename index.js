import express from "express";
import * as line from "@line/bot-sdk";
import { google } from "googleapis";

// ===== LINE =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// ===== Sheets =====
const SPREADSHEET_ID = "1ZgDYtjmF0eNSab654gGLrfl11i_jmaVQW2WmaVRV1Lw";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// ===== LINE client =====
const client = new line.Client(config);
const app = express();

// ===== webhook =====
app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.json({ ok: true }))
    .catch(console.error);
});

app.get("/", (req, res) => res.send("OK"));

// ===== メイン =====
async function handleEvent(event) {
  console.log("event:", JSON.stringify(event));

  const userId = event.source.userId;

  // ===== BAN無視 =====
  const banList = await get("ban");
  if (banList.includes(userId)) return;

  // ===== 入室挨拶 =====
  if (event.type === "memberJoined") {
    const on = (await get("settings"))[0] !== "OFF";
    if (!on) return;

    const list = await get("join");
    const msg = list.length
      ? list[Math.floor(Math.random() * list.length)]
      : "参加ありがとう！";

    return reply(event, msg);
  }

  // ===== メッセージ =====
  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text;

    // ===== menu =====
    if (text.includes("menu")) return client.replyMessage(event.replyToken, menu());

    if (text === "状態確認") return reply(event, "BOT正常稼働中");

    // ===== 管理 =====
    if (text === "管理一覧") return reply(event, (await get("admins")).join("\n") || "なし");

    if (text.startsWith("管理追加 ")) {
      await add("admins", [text.replace("管理追加 ", "")]);
      return reply(event, "追加OK");
    }

    if (text.startsWith("管理削除 ")) {
      await remove("admins", text.replace("管理削除 ", ""));
      return reply(event, "削除OK");
    }

    // ===== 副管理 =====
    if (text === "副管理一覧") return reply(event, (await get("subs")).join("\n") || "なし");

    if (text.startsWith("副管理追加 ")) {
      await add("subs", [text.replace("副管理追加 ", "")]);
      return reply(event, "追加OK");
    }

    if (text.startsWith("副管理削除 ")) {
      await remove("subs", text.replace("副管理削除 ", ""));
      return reply(event, "削除OK");
    }

    // ===== BAN =====
    if (text === "BAN一覧") return reply(event, (await get("ban")).join("\n") || "なし");

    if (text.startsWith("通報")) {
      await add("ban", [userId]);
      return reply(event, "BAN");
    }

    if (text.startsWith("BAN解除 ")) {
      await remove("ban", text.replace("BAN解除 ", ""));
      return reply(event, "解除OK");
    }

    // ===== NG =====
    if (text === "NG一覧") return reply(event, (await get("ng")).join("\n") || "なし");

    if (text.startsWith("NG追加 ")) {
      await add("ng", [text.replace("NG追加 ", "")]);
      return reply(event, "追加OK");
    }

    // ===== 挨拶 =====
    if (text === "挨拶ON") {
      await setSetting("ON");
      return reply(event, "ON");
    }

    if (text === "挨拶OFF") {
      await setSetting("OFF");
      return reply(event, "OFF");
    }

    if (text === "挨拶一覧") return reply(event, (await get("join")).join("\n") || "なし");

    if (text.startsWith("挨拶追加 ")) {
      await add("join", [text.replace("挨拶追加 ", "")]);
      return reply(event, "追加OK");
    }

    if (text.startsWith("挨拶削除 ")) {
      await remove("join", text.replace("挨拶削除 ", ""));
      return reply(event, "削除OK");
    }

    // ===== NG検知 =====
    const ng = await get("ng");
    if (ng.some(w => text.includes(w))) {
      await add("ban", [userId]);
      return reply(event, "NG→BAN");
    }

    // ===== ログ =====
    await add("log", [userId, text, new Date().toISOString()]);
  }

  return Promise.resolve(null);
}

// ===== menu（2列UI）=====
function menu() {
  const btn = (label, color="blue") => ({
    type: "button",
    style: "primary",
    color: color === "red" ? "#ff4444" : "#3399ff",
    action: { type: "message", label, text: label }
  });

  const row = (a,b) => ({
    type:"box",
    layout:"horizontal",
    spacing:"md",
    contents:[a,b]
  });

  return {
    type:"flex",
    altText:"menu",
    contents:{
      type:"bubble",
      body:{
        type:"box",
        layout:"vertical",
        spacing:"md",
        contents:[
          row(btn("管理一覧"),btn("副管理一覧")),
          row(btn("BAN一覧","red"),btn("NG一覧","red")),
          row(btn("管理追加"),btn("副管理追加")),
          row(btn("NG追加"),btn("通報","red")),
          row(btn("BAN解除"),btn("連投制限")),
          row(btn("挨拶ON"),btn("挨拶OFF")),
          row(btn("状態確認"),btn("挨拶一覧"))
        ]
      }
    }
  };
}

// ===== 共通 =====
function reply(event, text){
  return client.replyMessage(event.replyToken,{type:"text",text});
}

async function get(name){
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${name}!A:A`
  });
  return r.data.values ? r.data.values.flat() : [];
}

async function add(name, values){
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${name}!A:A`,
    valueInputOption:"RAW",
    requestBody:{values:[values]}
  });
}

async function remove(name, target){
  const list = await get(name);
  const filtered = list.filter(v=>v!==target);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${name}!A:A`
  });

  for(const v of filtered){
    await add(name,[v]);
  }
}

async function setSetting(val){
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range:"settings!A1",
    valueInputOption:"RAW",
    requestBody:{values:[[val]]}
  });
}

// ===== 起動 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("起動OK"));
