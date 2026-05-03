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

// ===== 管理判定 =====
async function isAdmin(g,u){
  if(u===OWNER) return true;
  const r = await getSheet("admins!A:B");
  return r.some(x=>x[0]===g && x[1]===u);
}

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req,res)=>{

try{

for(const e of req.body.events){

if(!e.source.groupId) continue;

const g = e.source.groupId;
const u = e.source.userId;

// ===== BANチェック（postbackは通す）=====
const isAdminUser = await isAdmin(g,u);
const banList = await getSheet("ban!A:B");
const banned = banList.some(x=>x[0]===g && x[1]===u);

if(e.type !== "postback" && banned && !isAdminUser){
  await send(e,{type:"text",text:"🚫 利用制限中"});
  continue;
}

// ===== postback =====
if(e.type==="postback"){

const d = e.postback.data;

// ===== 管理削除確認 =====
if(d.startsWith("confirm_admin_delete:")){
const id = d.split(":")[1];
return send(e,{
type:"template",
altText:"確認",
template:{
type:"confirm",
text:"この管理者を削除しますか？",
actions:[
{type:"postback",label:"はい",data:`admin_delete:${id}`},
{type:"message",label:"いいえ",text:"キャンセル"}
]
}
});
}

// ===== 管理削除 =====
if(d.startsWith("admin_delete:")){
const id = d.split(":")[1];
const rows = await getSheet("admins!A:B");
const filtered = rows.filter(x=>!(x[0]===g && x[1]===id));
await sheets.spreadsheets.values.update({
spreadsheetId:sheetId,
range:"admins!A:B",
valueInputOption:"RAW",
requestBody:{values:filtered}
});
return send(e,{type:"text",text:"削除完了"});
}

// ===== BAN確認 =====
if(d.startsWith("confirm_ban:")){
const id = d.split(":")[1];

if(id===OWNER){
return send(e,{type:"text",text:"オーナーはBAN不可"});
}

return send(e,{
type:"template",
altText:"確認",
template:{
type:"confirm",
text:"このユーザーをBANしますか？",
actions:[
{type:"postback",label:"はい",data:`ban_add:${id}`},
{type:"message",label:"いいえ",text:"キャンセル"}
]
}
});
}

// ===== BAN追加 =====
if(d.startsWith("ban_add:")){
const id = d.split(":")[1];
await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"ban!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,id]]}
});
return send(e,{type:"text",text:"BAN完了"});
}

// ===== BAN解除 =====
if(d.startsWith("ban_remove:")){
const id = d.split(":")[1];
const rows = await getSheet("ban!A:B");
const filtered = rows.filter(x=>!(x[0]===g && x[1]===id));
await sheets.spreadsheets.values.update({
spreadsheetId:sheetId,
range:"ban!A:B",
valueInputOption:"RAW",
requestBody:{values:filtered}
});
return send(e,{type:"text",text:"BAN解除"});
}

// ===== NG削除 =====
if(d.startsWith("ng_delete:")){
const word = d.split(":")[1];
const rows = await getSheet("ng!A:B");
const filtered = rows.filter(x=>!(x[0]===g && x[1]===word));
await sheets.spreadsheets.values.update({
spreadsheetId:sheetId,
range:"ng!A:B",
valueInputOption:"RAW",
requestBody:{values:filtered}
});
return send(e,{type:"text",text:"NG削除"});
}

}

// ===== メッセージ =====
if(e.type!=="message"||e.message.type!=="text") continue;

const t = e.message.text.trim();

// ===== menu =====
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
["管理一覧","NG一覧"],
["BAN一覧","状態確認"]
].map(row=>({
type:"box",
layout:"horizontal",
contents:row.map(txt=>({
type:"button",
style:"primary",
color:"#1565C0",
action:{type:"message",label:txt,text:txt}
}))
}))
]
}
}
});
}

// ===== 状態確認 =====
if(t.includes("状態確認")){
const settings = await getSheet("settings!A:D");
const row = settings.find(x=>x[0]===g);

return send(e,{
type:"text",
text:`📊 状態\n連投制限: ${row?.[1] || "未設定"}\n挨拶: ${row?.[2] || "OFF"}`
});
}

// ===== 管理一覧 =====
if(t.includes("管理一覧")){
const rows = await getSheet("admins!A:B");
const list = rows.filter(x=>x[0]===g);

const contents = [];

for(const r of list){
let name=r[1];
try{
const p=await client.getGroupMemberProfile(g,r[1]);
name=p.displayName;
}catch{}

contents.push({
type:"box",
layout:"horizontal",
justifyContent:"space-between",
contents:[
{type:"text",text:name,flex:3},
{
type:"button",
style:"primary",
color:"#D32F2F",
action:{type:"postback",label:"削除",data:`confirm_admin_delete:${r[1]}`}
},
{
type:"button",
style:"primary",
color:"#000000",
action:{type:"postback",label:"BAN",data:`confirm_ban:${r[1]}`}
}
]
});
}

return send(e,{
type:"flex",
altText:"管理一覧",
contents:{
type:"bubble",
body:{type:"box",layout:"vertical",contents:[
{type:"text",text:"管理一覧",weight:"bold"},
...contents
]}
}
});
}

// ===== NG一覧 =====
if(t.includes("NG一覧")){
const rows = await getSheet("ng!A:B");
const list = rows.filter(x=>x[0]===g);

const contents = list.map(r=>({
type:"box",
layout:"horizontal",
justifyContent:"space-between",
contents:[
{type:"text",text:r[1],flex:3},
{
type:"button",
style:"primary",
color:"#D32F2F",
action:{type:"postback",label:"削除",data:`ng_delete:${r[1]}`}
}
]
}));

return send(e,{
type:"flex",
altText:"NG一覧",
contents:{
type:"bubble",
body:{type:"box",layout:"vertical",contents:[
{type:"text",text:"NG一覧",weight:"bold"},
...contents
]}
}
});
}

// ===== BAN一覧 =====
if(t.includes("BAN一覧")){
const rows = await getSheet("ban!A:B");
const list = rows.filter(x=>x[0]===g);

const contents = [];

for(const r of list){
let name=r[1];
try{
const p=await client.getGroupMemberProfile(g,r[1]);
name=p.displayName;
}catch{}

contents.push({
type:"box",
layout:"horizontal",
justifyContent:"space-between",
contents:[
{type:"text",text:name,flex:3},
{
type:"button",
style:"primary",
color:"#2E7D32",
action:{type:"postback",label:"解除",data:`ban_remove:${r[1]}`}
}
]
});
}

return send(e,{
type:"flex",
altText:"BAN一覧",
contents:{
type:"bubble",
body:{type:"box",layout:"vertical",contents:[
{type:"text",text:"BAN一覧",weight:"bold"},
...contents
]}
}
});
}

}

}catch(err){
console.log("エラー:",err);
}

res.sendStatus(200);
});

app.listen(3000);
