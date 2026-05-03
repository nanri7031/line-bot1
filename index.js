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
const getMention = e => e.message.mention?.mentionees?.[0]?.userId;

const getSheet = async (range) => {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
    return res.data.values || [];
  } catch {
    return [];
  }
};

// ===== 管理判定 =====
async function isAdmin(g,u){
  if(u===OWNER) return true;
  const r = await getSheet("admins!A:B");
  return r.some(x=>x[0]===g && x[1]===u);
}

// ===== 設定 =====
async function getSetting(g){
  const rows = await getSheet("settings!A:D");
  return rows.reverse().find(r=>r[0]===g) || [g,5,"ON","ようこそ！"];
}
async function setSetting(g,l,gr,t){
  await sheets.spreadsheets.values.append({
    spreadsheetId:sheetId,
    range:"settings!A:D",
    valueInputOption:"RAW",
    requestBody:{values:[[g,l,gr,t]]}
  });
}

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req,res)=>{

try{

for(const e of req.body.events){

if(!e.source.groupId) continue;

const g = e.source.groupId;
const u = e.source.userId;
const set = await getSetting(g);

// ===== BANチェック =====
const banList = await getSheet("ban!A:B");
if(banList.some(x=>x[0]===g && x[1]===u)){
  await send(e,{type:"text",text:"🚫 あなたは利用制限中です"});
  continue;
}

// ===== 入室挨拶 =====
if(e.type==="memberJoined"){
  if(set[2]==="ON"){
    await send(e,{type:"text",text:set[3]});
  }
  continue;
}

if(e.type!=="message"||e.message.type!=="text") continue;

const t = e.message.text.trim();

// ===== NG検知 → 警告 → BAN =====
const ngList = await getSheet("ng!A:B");
const ngWords = ngList.filter(x=>x[0]===g).map(x=>x[1]);

if(ngWords.some(w=>t.includes(w))){
  const warn = await getSheet("warn!A:C");
  let count = 1;
  const row = warn.find(x=>x[0]===g && x[1]===u);
  if(row) count = Number(row[2]) + 1;

  await sheets.spreadsheets.values.append({
    spreadsheetId:sheetId,
    range:"warn!A:C",
    valueInputOption:"RAW",
    requestBody:{values:[[g,u,count]]}
  });

  if(count>=3){
    await sheets.spreadsheets.values.append({
      spreadsheetId:sheetId,
      range:"ban!A:B",
      valueInputOption:"RAW",
      requestBody:{values:[[g,u]]}
    });
    return send(e,{type:"text",text:"🚫 NG違反によりBAN"});
  }

  return send(e,{type:"text",text:`⚠️ NGワード (${count}/3)`});
}

// ===== menu（2列UI）=====
if(t==="menu"){
await send(e,{
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
contents:row.map(txt=>({
type:"button",
style:"primary",
action:{type:"message",label:txt.split(" ")[0],text:txt}
}))
}))

]
}
}
});
continue;
}

// ===== 管理登録 =====
if(t.startsWith("管理登録")){
if(t.split(" ")[1]!==PASS) return send(e,{type:"text",text:"パス違い"});
await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"admins!A:C",
valueInputOption:"RAW",
requestBody:{values:[[g,u,"管理者"]]}
});
return send(e,{type:"text",text:"登録OK"});
}

// ===== 管理追加 =====
if(t.startsWith("管理追加")){
if(!(await isAdmin(g,u))) return send(e,{type:"text",text:"管理者のみ"});
const target=getMention(e);
if(!target) return send(e,{type:"text",text:"メンションして"});
await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"admins!A:C",
valueInputOption:"RAW",
requestBody:{values:[[g,target,"追加"]]}
});
return send(e,{type:"text",text:"管理追加OK"});
}

// ===== 管理削除 =====
if(t.startsWith("管理削除")){
if(!(await isAdmin(g,u))) return send(e,{type:"text",text:"管理者のみ"});
const target=getMention(e);
const rows=await getSheet("admins!A:B");
const filtered=rows.filter(x=>!(x[0]===g&&x[1]===target));
await sheets.spreadsheets.values.update({
spreadsheetId:sheetId,
range:"admins!A:B",
valueInputOption:"RAW",
requestBody:{values:filtered}
});
return send(e,{type:"text",text:"削除OK"});
}

// ===== BAN =====
if(t.startsWith("BAN追加")){
if(!(await isAdmin(g,u))) return send(e,{type:"text",text:"管理者のみ"});
const target=getMention(e);
await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"ban!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,target]]}
});
return send(e,{type:"text",text:"BAN完了"});
}

if(t.startsWith("BAN解除")){
const target=getMention(e);
const rows=await getSheet("ban!A:B");
const filtered=rows.filter(x=>!(x[0]===g&&x[1]===target));
await sheets.spreadsheets.values.update({
spreadsheetId:sheetId,
range:"ban!A:B",
valueInputOption:"RAW",
requestBody:{values:filtered}
});
return send(e,{type:"text",text:"BAN解除OK"});
}

if(t==="BAN一覧"){
const r=await getSheet("ban!A:B");
return send(e,{type:"text",text:r.filter(x=>x[0]===g).map(x=>x[1]).join("\n")||"なし"});
}

}

}catch(err){
console.log("致命エラー:",err);
}

res.sendStatus(200);
});

app.listen(3000);
