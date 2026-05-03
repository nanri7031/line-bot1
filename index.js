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

// ===== 安定返信 =====
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
const isAdmin = async (g,u) => {
  if(u===OWNER) return true;
  const r = await getSheet("admins!A:B");
  return r.some(x=>x[0]===g && x[1]===u);
};

const isSub = async (g,u) => {
  const r = await getSheet("subs!A:B");
  return r.some(x=>x[0]===g && x[1]===u);
};

// ===== spam =====
const spamMap = {};

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req,res)=>{

try{

for(const e of req.body.events){

if(!e.source.groupId) continue;

const g = e.source.groupId;
const u = e.source.userId;

// ===== 権限 =====
const admin = await isAdmin(g,u);
const sub = await isSub(g,u);

// =======================
// 🔥 postback（ここが核心）
// =======================
if(e.type==="postback"){
const d = e.postback.data;

// 管理削除
if(d.startsWith("admin_delete:")){
const id = d.split(":")[1];
const rows = await getSheet("admins!A:B");
await setSheet("admins!A:B", rows.filter(x=>!(x[0]===g && x[1]===id)));
return send(e,{type:"text",text:"管理削除完了"});
}

// 副管理削除
if(d.startsWith("sub_delete:")){
const id = d.split(":")[1];
const rows = await getSheet("subs!A:B");
await setSheet("subs!A:B", rows.filter(x=>!(x[0]===g && x[1]===id)));
return send(e,{type:"text",text:"副管理削除完了"});
}

// NG削除
if(d.startsWith("ng_delete:")){
const word = d.split(":")[1];
const rows = await getSheet("ng!A:B");
await setSheet("ng!A:B", rows.filter(x=>!(x[0]===g && x[1]===word)));
return send(e,{type:"text",text:"NG削除完了"});
}

// BAN解除
if(d.startsWith("ban_remove:")){
const id = d.split(":")[1];
const rows = await getSheet("ban!A:B");
await setSheet("ban!A:B", rows.filter(x=>!(x[0]===g && x[1]===id)));
return send(e,{type:"text",text:"BAN解除完了"});
}
}

// ===== message =====
if(e.type!=="message"||e.message.type!=="text") continue;

const t = e.message.text.trim();

// ===== 連投制限 =====
const now = Date.now();
spamMap[g] = spamMap[g]||{};
spamMap[g][u] = spamMap[g][u]||[];
spamMap[g][u].push(now);
spamMap[g][u] = spamMap[g][u].filter(ts=>now-ts<10000);

const set = await getSheet("settings!A:B");
const row = set.find(x=>x[0]===g);
const limit = Number(row?.[1]||5);

if(spamMap[g][u].length>limit && !admin){
return send(e,{type:"text",text:"🚫 連投制限"});
}

// ===== 管理登録 =====
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

// ===== 副管理追加 =====
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

// ===== 管理一覧 =====
if(t==="管理一覧"){
const rows = await getSheet("admins!A:B");
const list = rows.filter(x=>x[0]===g);
if(!list.length) return send(e,{type:"text",text:"なし"});

return send(e,{
type:"flex",
altText:"管理一覧",
contents:{
type:"bubble",
body:{
type:"box",
layout:"vertical",
contents:[
{type:"text",text:"管理一覧",weight:"bold"},
...list.map(r=>({
type:"box",
layout:"horizontal",
contents:[
{type:"text",text:r[1],flex:3},
{type:"button",style:"primary",color:"#D32F2F",
action:{type:"postback",label:"削除",data:`admin_delete:${r[1]}`}}
]
}))
]
}
}
});
}

// ===== 副管理一覧 =====
if(t==="副管理一覧"){
const rows = await getSheet("subs!A:B");
const list = rows.filter(x=>x[0]===g);
if(!list.length) return send(e,{type:"text",text:"なし"});

return send(e,{
type:"flex",
altText:"副管理一覧",
contents:{
type:"bubble",
body:{
type:"box",
layout:"vertical",
contents:[
{type:"text",text:"副管理一覧",weight:"bold"},
...list.map(r=>({
type:"box",
layout:"horizontal",
contents:[
{type:"text",text:r[1],flex:3},
{type:"button",style:"primary",color:"#F57C00",
action:{type:"postback",label:"削除",data:`sub_delete:${r[1]}`}}
]
}))
]
}
}
});
}

// ===== NG一覧 =====
if(t==="NG一覧"){
const rows = await getSheet("ng!A:B");
const list = rows.filter(x=>x[0]===g);

return send(e,{
type:"flex",
altText:"NG一覧",
contents:{
type:"bubble",
body:{
type:"box",
layout:"vertical",
contents:[
{type:"text",text:"NG一覧",weight:"bold"},
...list.map(r=>({
type:"box",
layout:"horizontal",
contents:[
{type:"text",text:r[1],flex:3},
{type:"button",style:"primary",color:"#D32F2F",
action:{type:"postback",label:"削除",data:`ng_delete:${r[1]}`}}
]
}))
]
}
}
});
}

// ===== 連投制限設定 =====
if(t.startsWith("連投制限")){
if(!admin) return send(e,{type:"text",text:"権限なし"});
const num = t.replace("連投制限","").trim();
await setSheet("settings!A:B", [[g,num]]);
return send(e,{type:"text",text:"設定OK"});
}

// ===== 状態確認 =====
if(t==="状態確認"){
return send(e,{type:"text",text:`📊 状態\n連投制限:${limit}`});
}

// ===== 挨拶登録 =====
if(t.startsWith("挨拶登録")){
const msg = t.replace("挨拶登録","").trim();
await setSheet("settings!A:C", [[g,limit,msg]]);
return send(e,{type:"text",text:"挨拶登録OK"});
}

// ===== 挨拶確認 =====
if(t==="挨拶確認"){
const rows = await getSheet("settings!A:C");
const r = rows.find(x=>x[0]===g);
return send(e,{type:"text",text:r?.[2]||"未設定"});
}

}

}catch(err){
console.log("ERR:",err);
}

res.sendStatus(200);
});

app.listen(3000);
