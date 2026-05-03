import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import { google } from "googleapis";

const app = express();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new Client(config);

// ===== 安定送信 =====
const send = async (event, msg) => {
  try {
    await client.replyMessage(event.replyToken, msg);
  } catch {
    try {
      if (event.source.groupId) {
        await client.pushMessage(event.source.groupId, msg);
      } else {
        await client.pushMessage(event.source.userId, msg);
      }
    } catch (e) {
      console.log("push失敗", e);
    }
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

const OWNER = "U1a1aca9e44466f8cb05003d7dc86fee0";
const PASS = "1234";

// ===== util =====
const getMention = e => e.message.mention?.mentionees?.[0]?.userId;
const getSheet = async r =>
  (await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: r })).data.values || [];

// ===== settings =====
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

// ===== 管理 =====
async function isAdmin(g,u){
  if(u===OWNER) return true;
  const r = await getSheet("admins!A:B");
  return r.some(x=>x[0]===g && x[1]===u);
}
async function isSub(g,u){
  const r = await getSheet("subs!A:B");
  return r.some(x=>x[0]===g && x[1]===u);
}

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req,res)=>{

for(const e of req.body.events){

if(!e.source.groupId) continue;

const g = e.source.groupId;
const u = e.source.userId;
const set = await getSetting(g);

// ===== 入室挨拶 =====
if(e.type==="memberJoined"){
  if(set[2]==="ON"){
    await send(e,{type:"text",text:set[3]});
  }
  continue;
}

if(e.type!=="message"||e.message.type!=="text") continue;

const t = e.message.text.trim();

// ===== menu（安定Flex）=====
if(t==="menu"){
await send(e,{
type:"flex",
altText:"管理メニュー",
contents:{
type:"bubble",
body:{
type:"box",
layout:"vertical",
spacing:"md",
contents:[

{type:"text",text:"管理メニュー",weight:"bold",size:"lg",align:"center"},

{type:"button",style:"primary",action:{type:"message",label:"管理登録",text:"管理登録 1234"}},
{type:"button",style:"primary",action:{type:"message",label:"管理一覧",text:"管理一覧"}},

{type:"button",style:"primary",action:{type:"message",label:"管理追加",text:"管理追加"}},
{type:"button",style:"primary",action:{type:"message",label:"管理削除",text:"管理削除"}},

{type:"button",style:"primary",action:{type:"message",label:"副管理追加",text:"副管理追加"}},
{type:"button",style:"primary",action:{type:"message",label:"副管理削除",text:"副管理削除"}},
{type:"button",style:"primary",action:{type:"message",label:"副管理一覧",text:"副管理一覧"}},

{type:"button",style:"primary",color:"#D32F2F",action:{type:"message",label:"NG追加",text:"NG追加 test"}},
{type:"button",style:"primary",action:{type:"message",label:"NG削除",text:"NG削除 test"}},
{type:"button",style:"primary",action:{type:"message",label:"NG一覧",text:"NG一覧"}},

{type:"button",style:"primary",action:{type:"message",label:"連投制限",text:"連投制限 5"}},
{type:"button",style:"primary",action:{type:"message",label:"状態確認",text:"状態確認"}},

{type:"button",style:"primary",color:"#212121",action:{type:"message",label:"挨拶ON",text:"挨拶ON"}},
{type:"button",style:"primary",color:"#424242",action:{type:"message",label:"挨拶OFF",text:"挨拶OFF"}},

{type:"button",style:"primary",action:{type:"message",label:"挨拶登録",text:"挨拶登録 ようこそ！"}},
{type:"button",style:"primary",action:{type:"message",label:"挨拶確認",text:"挨拶確認"}}

]}}});
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
if(!target) return send(e,{type:"text",text:"追加したい人をメンションして"});
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
if(target===OWNER) return send(e,{type:"text",text:"削除不可"});
const rows=await getSheet("admins!A:B");
const filtered=rows.filter(x=>!(x[0]===g&&x[1]===target));
await sheets.spreadsheets.values.clear({spreadsheetId:sheetId,range:"admins!A:B"});
await sheets.spreadsheets.values.update({
spreadsheetId:sheetId,
range:"admins!A:B",
valueInputOption:"RAW",
requestBody:{values:filtered}
});
return send(e,{type:"text",text:"削除OK"});
}

// ===== 管理一覧 =====
if(t==="管理一覧"){
const r=await getSheet("admins!A:B");
return send(e,{type:"text",text:r.filter(x=>x[0]===g).map(x=>x[1]).join("\n")||"なし"});
}

// ===== 副管理 =====
if(t.startsWith("副管理追加")){
if(!(await isAdmin(g,u))) return send(e,{type:"text",text:"管理者のみ"});
const target=getMention(e);
await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"subs!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,target]]}
});
return send(e,{type:"text",text:"副管理追加OK"});
}

if(t.startsWith("副管理削除")){
const target=getMention(e);
const rows=await getSheet("subs!A:B");
const filtered=rows.filter(x=>!(x[0]===g&&x[1]===target));
await sheets.spreadsheets.values.clear({spreadsheetId:sheetId,range:"subs!A:B"});
await sheets.spreadsheets.values.update({
spreadsheetId:sheetId,
range:"subs!A:B",
valueInputOption:"RAW",
requestBody:{values:filtered}
});
return send(e,{type:"text",text:"削除OK"});
}

if(t==="副管理一覧"){
const r=await getSheet("subs!A:B");
return send(e,{type:"text",text:r.filter(x=>x[0]===g).map(x=>x[1]).join("\n")||"なし"});
}

// ===== NG =====
if(t.startsWith("NG追加")){
if(!(await isAdmin(g,u))) return send(e,{type:"text",text:"権限なし"});
const w=t.replace("NG追加","").trim();
await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"ng!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,w]]}
});
return send(e,{type:"text",text:"追加OK"});
}

if(t.startsWith("NG削除")){
const w=t.replace("NG削除","").trim();
const rows=await getSheet("ng!A:B");
const filtered=rows.filter(x=>!(x[0]===g&&x[1]===w));
await sheets.spreadsheets.values.clear({spreadsheetId:sheetId,range:"ng!A:B"});
await sheets.spreadsheets.values.update({
spreadsheetId:sheetId,
range:"ng!A:B",
valueInputOption:"RAW",
requestBody:{values:filtered}
});
return send(e,{type:"text",text:"削除OK"});
}

if(t==="NG一覧"){
const r=await getSheet("ng!A:B");
return send(e,{type:"text",text:r.filter(x=>x[0]===g).map(x=>x[1]).join("\n")||"なし"});
}

// ===== 設定 =====
if(t.startsWith("連投制限")){
const num=t.replace("連投制限","").trim();
await setSetting(g,num,set[2],set[3]);
return send(e,{type:"text",text:"設定OK"});
}

if(t==="状態確認"){
return send(e,{type:"text",text:`制限:${set[1]}\n挨拶:${set[2]}`});
}

// ===== 挨拶 =====
if(t==="挨拶ON"){await setSetting(g,set[1],"ON",set[3]);return send(e,{type:"text",text:"ON"});}
if(t==="挨拶OFF"){await setSetting(g,set[1],"OFF",set[3]);return send(e,{type:"text",text:"OFF"});}

if(t.startsWith("挨拶登録")){
const txt=t.replace("挨拶登録","").trim();
await setSetting(g,set[1],set[2],txt);
return send(e,{type:"text",text:"登録OK"});
}

if(t==="挨拶確認"){
return send(e,{type:"text",text:`状態:${set[2]}\n内容:${set[3]}`});
}

}
res.sendStatus(200);
});

app.listen(3000);
