import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import { google } from "googleapis";

const app = express();

// ===== LINE =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new Client(config);

// ===== 安定送信 =====
const send = async (e, msg) => {
  try {
    await client.replyMessage(e.replyToken, msg);
  } catch {
    const id = e.source.groupId || e.source.userId;
    try { await client.pushMessage(id, msg); } catch {}
  }
};

// ===== Google =====
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });
const sheetId = process.env.SPREADSHEET_ID;

// ===== 固定 =====
const OWNER = "U1a1aca9e44466f8cb05003d7dc86fee0";
const PASS = "1234";

// ===== util =====
const getSheet = async (range) => {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range
    });
    return res.data.values || [];
  } catch {
    return [];
  }
};

const setSheet = async (range, values) => {
  await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range });
  if (values.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values }
    });
  }
};

// ===== 権限 =====
async function isAdmin(g,u){
  if(u===OWNER) return true;
  const r = await getSheet("admins!A:B");
  return r.some(x=>x[0]===g && x[1]===u);
}

async function isSub(g,u){
  const r = await getSheet("subs!A:B");
  return r.some(x=>x[0]===g && x[1]===u);
}

// ===== 連投管理 =====
const spamMap = {};

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req,res)=>{

try{

for(const e of req.body.events){

if(!e.source.groupId) continue;

const g = e.source.groupId;
const u = e.source.userId;

// ===== 権限取得 =====
const admin = await isAdmin(g,u);
const sub = await isSub(g,u);

// ===== BAN制御 =====
const banList = await getSheet("ban!A:B");
const banned = banList.some(x=>x[0]===g && x[1]===u);

if(e.type!=="postback" && banned && !admin){
  await send(e,{type:"text",text:"🚫 利用制限中"});
  continue;
}

// ===== メッセージのみ =====
if(e.type!=="message"||e.message.type!=="text") continue;

const t = e.message.text.trim();

// =========================
// 🔥 NG検知（自動）
// =========================
const ngList = await getSheet("ng!A:B");
const ngWords = ngList.filter(x=>x[0]===g).map(x=>x[1]);

if(ngWords.some(w=>t.includes(w)) && !admin){
  await send(e,{type:"text",text:"⚠️ NGワード検知"});
  continue;
}

// =========================
// 🔥 連投制限（実動作）
// =========================
const now = Date.now();
spamMap[g] = spamMap[g] || {};
spamMap[g][u] = spamMap[g][u] || [];

spamMap[g][u].push(now);

// 10秒以内
spamMap[g][u] = spamMap[g][u].filter(ts => now - ts < 10000);

const limitData = await getSheet("settings!A:B");
const limitRow = limitData.find(x=>x[0]===g);
const limit = Number(limitRow?.[1] || 5);

if(spamMap[g][u].length > limit && !admin){
  await send(e,{type:"text",text:"🚫 連投制限"});
  continue;
}

// =========================
// 🔥 メニュー
// =========================
if(t==="menu"){
return send(e,{
type:"flex",
altText:"管理メニュー",
contents:{
type:"bubble",
body:{
type:"box",
layout:"vertical",
contents:[
{type:"text",text:"管理メニュー",weight:"bold",size:"lg"},

...[
["管理登録 1234","管理一覧"],
["管理追加","管理削除"],
["副管理追加","副管理削除"],
["副管理一覧","状態確認"],
["NG追加 test","NG一覧"],
["NG削除 test","連投制限 5"],
["BAN追加","BAN解除"],
["BAN一覧","状態確認"],
["挨拶ON","挨拶OFF"],
["挨拶登録 ようこそ！","挨拶確認"]
].map(row=>({
type:"box",
layout:"horizontal",
contents:row.map(txt=>{

let color="#1565C0";
if(txt.includes("削除")||txt.includes("NG")) color="#D32F2F";
if(txt.includes("BAN追加")||txt.includes("BAN一覧")) color="#000000";
if(txt.includes("解除")) color="#2E7D32";

return{
type:"button",
style:"primary",
color,
flex:1,
action:{type:"message",label:txt.split(" ")[0],text:txt}
};
})
}))
]
}
}
});
}

// =========================
// 🔥 管理登録
// =========================
if(t.startsWith("管理登録")){
const pass = t.replace("管理登録","").trim();
if(pass!==PASS) return send(e,{type:"text",text:"パス違い"});

await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"admins!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,u]]}
});

return send(e,{type:"text",text:"管理者登録OK"});
}

// =========================
// 🔥 副管理追加
// =========================
if(t.startsWith("副管理追加")){
if(!admin) return send(e,{type:"text",text:"権限なし"});

const mention = e.message.mention?.mentionees?.[0]?.userId;
if(!mention) return send(e,{type:"text",text:"メンションして"});

await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"subs!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,mention]]}
});

return send(e,{type:"text",text:"副管理追加OK"});
}

// =========================
// 🔥 NG追加
// =========================
if(t.startsWith("NG追加")){
if(!admin && !sub) return send(e,{type:"text",text:"権限なし"});

const word = t.replace("NG追加","").trim();
await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"ng!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,word]]}
});

return send(e,{type:"text",text:"NG追加OK"});
}

// =========================
// 🔥 連投制限変更
// =========================
if(t.startsWith("連投制限")){
if(!admin) return send(e,{type:"text",text:"権限なし"});

const num = t.replace("連投制限","").trim();

await setSheet("settings!A:B", [[g,num]]);

return send(e,{type:"text",text:"設定OK"});
}

}

}catch(err){
console.log(err);
}

res.sendStatus(200);
});

app.listen(3000);
