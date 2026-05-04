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
const isAdmin = async (g,u)=>{
  if(u===OWNER) return true;
  const r = await getSheet("admins!A:B");
  return r.some(x=>x[0]===g && x[1]===u);
};

const isSub = async (g,u)=>{
  const r = await getSheet("subs!A:B");
  return r.some(x=>x[0]===g && x[1]===u);
};

// ===== spam =====
const spamMap = {};

app.post("/webhook", middleware(config), async (req,res)=>{

try{

for(const e of req.body.events){

if(!e.source.groupId) continue;

const g = e.source.groupId;
const u = e.source.userId;

const admin = await isAdmin(g,u);
const sub = await isSub(g,u);

// =====================
// POSTBACK
// =====================
if(e.type==="postback"){
const d = e.postback.data;

if(d.startsWith("admin_delete:")){
const id=d.split(":")[1];
const rows=await getSheet("admins!A:B");
await setSheet("admins!A:B",rows.filter(x=>!(x[0]===g&&x[1]===id)));
return send(e,{type:"text",text:"管理削除完了"});
}

if(d.startsWith("sub_delete:")){
const id=d.split(":")[1];
const rows=await getSheet("subs!A:B");
await setSheet("subs!A:B",rows.filter(x=>!(x[0]===g&&x[1]===id)));
return send(e,{type:"text",text:"副管理削除完了"});
}

if(d.startsWith("ng_delete:")){
const word=d.split(":")[1];
const rows=await getSheet("ng!A:B");
await setSheet("ng!A:B",rows.filter(x=>!(x[0]===g&&x[1]===word)));
return send(e,{type:"text",text:"NG削除完了"});
}

if(d.startsWith("ban_remove:")){
const id=d.split(":")[1];
const rows=await getSheet("ban!A:B");
await setSheet("ban!A:B",rows.filter(x=>!(x[0]===g&&x[1]===id)));
return send(e,{type:"text",text:"BAN解除完了"});
}
}

// =====================
// MESSAGE
// =====================
if(e.type!=="message"||e.message.type!=="text") continue;

const t = e.message.text.trim();
const cmd = t.toLowerCase();

// =====================
// MENU
// =====================
if(cmd==="menu"){
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

// =====================
// 管理一覧（名前表示＋削除ボタン）
// =====================
if(cmd==="管理一覧"){
const rows=await getSheet("admins!A:B");
const list=rows.filter(x=>x[0]===g);

if(!list.length) return send(e,{type:"text",text:"なし"});

const contents = [];

for(const r of list){
let name = r[1];
try{
const p = await client.getGroupMemberProfile(g,r[1]);
name = p.displayName;
}catch{}

contents.push({
type:"box",
layout:"horizontal",
contents:[
{type:"text",text:name,flex:3,wrap:true},
{
type:"button",
style:"primary",
color:"#D32F2F",
action:{type:"postback",label:"削除",data:`admin_delete:${r[1]}`}
}
]
});
}

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
...contents
]
}
}
});
}

// =====================
// 副管理一覧（名前表示＋削除）
// =====================
if(cmd==="副管理一覧"){
const rows=await getSheet("subs!A:B");
const list=rows.filter(x=>x[0]===g);

if(!list.length) return send(e,{type:"text",text:"なし"});

const contents = [];

for(const r of list){
let name = r[1];
try{
const p = await client.getGroupMemberProfile(g,r[1]);
name = p.displayName;
}catch{}

contents.push({
type:"box",
layout:"horizontal",
contents:[
{type:"text",text:name,flex:3},
{
type:"button",
style:"primary",
color:"#F57C00",
action:{type:"postback",label:"削除",data:`sub_delete:${r[1]}`}
}
]
});
}

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
...contents
]
}
}
});
}

// =====================
// NG一覧（削除ボタン）
// =====================
if(cmd==="ng一覧"){
const rows=await getSheet("ng!A:B");
const list=rows.filter(x=>x[0]===g);

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
{
type:"button",
style:"primary",
color:"#D32F2F",
action:{type:"postback",label:"削除",data:`ng_delete:${r[1]}`}
}
]
}))
]
}
}
});
}

// =====================
// BAN一覧（解除ボタン）
// =====================
if(cmd==="ban一覧"){
const rows=await getSheet("ban!A:B");
const list=rows.filter(x=>x[0]===g);

if(!list.length) return send(e,{type:"text",text:"なし"});

return send(e,{
type:"flex",
altText:"BAN一覧",
contents:{
type:"bubble",
body:{
type:"box",
layout:"vertical",
contents:[
{type:"text",text:"BAN一覧",weight:"bold"},
...list.map(r=>({
type:"box",
layout:"horizontal",
contents:[
{type:"text",text:r[1],flex:3},
{
type:"button",
style:"primary",
color:"#2E7D32",
action:{type:"postback",label:"解除",data:`ban_remove:${r[1]}`}
}
]
}))
]
}
}
});
}

// =====================
// 状態確認
// =====================
if(cmd==="状態確認"){
const set=await getSheet("settings!A:B");
const row=set.find(x=>x[0]===g);
const limit=Number(row?.[1]||5);

return send(e,{type:"text",text:`📊 状態\n連投制限:${limit}`});
}

}

}catch(err){
console.log(err);
}

res.sendStatus(200);
});

app.listen(3000);
