import express from "express";
import * as line from "@line/bot-sdk";
import { google } from "googleapis";

const app = express();

// ===== LINE =====
const client = new line.Client({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
});

// ===== Sheets =====
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// ===== ヘルパー =====
async function get(range){
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range
  });
  return res.data.values || [];
}

async function add(range, val){
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption:"RAW",
    requestBody:{ values:val }
  });
}

async function set(range, val){
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption:"RAW",
    requestBody:{ values:val }
  });
}

// ===== Webhook =====
app.use("/webhook", line.middleware({
  channelSecret: process.env.CHANNEL_SECRET
}));

app.post("/webhook", async (req,res)=>{
  await Promise.all(req.body.events.map(handleEvent));
  res.sendStatus(200);
});

// ===== メニューUI =====
function menu(){
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
          btnRow("管理一覧","admin list","#00C851","副管理一覧","sub list","#00C851"),
          btnRow("BAN一覧","ban list","#ff4444","NG一覧","ng list","#ffbb33"),
          btnRow("管理追加","admin add ","#33b5e5","管理削除","admin remove ","#ff4444"),
          btnRow("副管理追加","sub add ","#33b5e5","副管理削除","sub remove ","#ff4444"),
          btnRow("NG追加","ng add ","#ffbb33","通報","通報 ","#ff4444"),
          btnRow("BAN解除","unban ","#00C851","状態確認","ping","#1E90FF")
        ]
      }
    }
  };
}

function btnRow(t1,m1,c1,t2,m2,c2){
  return {
    type:"box",
    layout:"horizontal",
    spacing:"md",
    contents:[
      btn(t1,m1,c1),
      btn(t2,m2,c2)
    ]
  };
}

function btn(label,text,color){
  return {
    type:"button",
    style:"primary",
    color,
    action:{ type:"message", label, text }
  };
}

// ===== メイン =====
async function handleEvent(event){

  if(event.type!=="message" || event.message.type!=="text") return;

  const text = event.message.text;
  const userId = event.source.userId;

  const admins = (await get("admins!A:A")).map(v=>v[0]);
  const subs = (await get("subs!A:A")).map(v=>v[0]);
  const bans = (await get("ban!A:A")).map(v=>v[0]);
  const ngs = (await get("ng!A:A")).map(v=>v[0]);

  const isAdmin = admins.includes(userId);
  const isSub = subs.includes(userId);

  if(bans.includes(userId)) return;

  // ===== menu =====
  if(text==="menu"){
    return reply(event, menu());
  }

  // ===== ping =====
  if(text==="ping"){
    return reply(event, {type:"text",text:"OK"});
  }

  // ===== 管理追加 =====
  if(text.startsWith("admin add ") && isAdmin){
    await add("admins!A:A", [[text.split(" ")[2]]]);
  }

  if(text==="admin list"){
    return reply(event, {type:"text",text:admins.join("\n") || "なし"});
  }

  // ===== 副管理 =====
  if(text.startsWith("sub add ") && isAdmin){
    await add("subs!A:A", [[text.split(" ")[2]]]);
  }

  if(text==="sub list"){
    return reply(event, {type:"text",text:subs.join("\n") || "なし"});
  }

  // ===== BAN =====
  if(text.startsWith("通報 ")){
    await add("ban!A:A", [[text.split(" ")[1]]]);
  }

  if(text==="ban list"){
    return reply(event, {type:"text",text:bans.join("\n") || "なし"});
  }

  // ===== NG =====
  if(text.startsWith("ng add ")){
    await add("ng!A:A", [[text.split(" ")[2]]]);
  }

  if(text==="ng list"){
    return reply(event, {type:"text",text:ngs.join("\n") || "なし"});
  }

  for(let w of ngs){
    if(text.includes(w)){
      await add("ban!A:A", [[userId]]);
      return reply(event,{type:"text",text:"NG BAN"});
    }
  }

  // ===== ログ =====
  await add("log!A:B", [[new Date().toISOString(), text]]);
}

// ===== reply =====
function reply(event, msg){
  return client.replyMessage(event.replyToken, msg);
}

// ===== 起動 =====
app.listen(10000, ()=>console.log("起動OK"));
