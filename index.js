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

// ===== 安全送信（reply失敗→pushフォールバック）=====
const send = async (e, msg) => {
  try {
    await client.replyMessage(e.replyToken, msg);
  } catch (err) {
    console.log("reply失敗:", err.message);
    try {
      const id = e.source.groupId || e.source.userId;
      await client.pushMessage(id, msg);
    } catch (e2) {
      console.log("push失敗:", e2.message);
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

// ===== 固定 =====
const OWNER = "U1a1aca9e44466f8cb05003d7dc86fee0";
const PASS = "1234";

// ===== util =====
const getMention = e => e.message.mention?.mentionees?.[0]?.userId;

// Sheets安全取得
const getSheet = async (range) => {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range
    });
    return res.data.values || [];
  } catch (e) {
    console.log("Sheetエラー:", e.message);
    return [];
  }
};

// ===== settings =====
async function getSetting(g){
  const rows = await getSheet("settings!A:D");
  return rows.reverse().find(r=>r[0]===g) || [g,5,"ON","ようこそ！"];
}
async function setSetting(g,l,gr,t){
  try{
    await sheets.spreadsheets.values.append({
      spreadsheetId:sheetId,
      range:"settings!A:D",
      valueInputOption:"RAW",
      requestBody:{values:[[g,l,gr,t]]}
    });
  }catch(e){ console.log("setting保存エラー", e.message); }
}

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
const set = await getSetting(g);

// ===== 入室挨拶 =====
if(e.type==="memberJoined"){
  if(set[2]==="ON"){
    await send(e,{type:"text",text:set[3]});
  }
  continue;
}

if(e.type!=="message" || e.message.type!=="text") continue;

const t = e.message.text.trim();

// ===== menu（2列・安全Flex）=====
if(t==="menu"){
await send(e,{
type:"flex",
altText:"管理メニュー",
contents:{
type:"bubble",
size:"mega",
body:{
type:"box",
layout:"vertical",
spacing:"md",
contents:[

// タイトル
{
type:"box",
layout:"vertical",
backgroundColor:"#0D47A1",
paddingAll:"12px",
contents:[
{type:"text",text:"管理メニュー",color:"#ffffff",align:"center",weight:"bold",size:"lg"}
]
},

// 2列ボタン生成（安全）
...[
["管理登録 1234","管理一覧"],
["管理追加","管理削除"],
["副管理追加","副管理削除"],
["副管理一覧","状態確認"],
["NG追加 test","NG一覧"],
["NG削除 test","連投制限 5"],
["挨拶ON","挨拶OFF"],
["挨拶登録 ようこそ！","挨拶確認"]
].map(row=>({
type:"box",
layout:"horizontal",
spacing:"sm",
contents:row.map(txt=>({
type:"button",
style:"primary",
color:
txt.includes("NG") ? "#D32F2F" :
txt.includes("副") ? "#2E7D32" :
txt.includes("挨拶") ? "#212121" :
"#1565C0",
action:{
type:"message",
label:txt.split(" ")[0],
text:txt
}
}
))
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
if(!target) return send(e,{type:"text",text:"メンションして"});
if(target===OWNER) return send(e,{type:"text",text:"削除不可"});
const rows=await getSheet("admins!A:B");
const filtered=rows.filter(x=>!(x[0]===g && x[1]===target));
await sheets.spreadsheets.values.update({
spreadsheetId:sheetId,
range:"admins!A:B",
valueInputOption:"RAW",
requestBody:{values:filtered}
});
return send(e,{type:"text",text:"削除OK"});
}

// ===== 管理一覧（名前表示）=====
if(t==="管理一覧"){
const rows=await getSheet("admins!A:B");
const list=rows.filter(x=>x[0]===g);
const names = [];
for(const r of list){
  let name=r[1];
  try{
    const p=await client.getGroupMemberProfile(g,r[1]);
    name=p.displayName;
  }catch{}
  names.push(name);
}
return send(e,{type:"text",text:names.join("\n")||"なし"});
}

// ===== 副管理 =====
if(t.startsWith("副管理追加")){
if(!(await isAdmin(g,u))) return send(e,{type:"text",text:"管理者のみ"});
const target=getMention(e);
if(!target) return send(e,{type:"text",text:"メンションして"});
await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"subs!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,target]]}
});
return send(e,{type:"text",text:"副管理追加OK"});
}

if(t.startsWith("副管理削除")){
if(!(await isAdmin(g,u))) return send(e,{type:"text",text:"管理者のみ"});
const target=getMention(e);
if(!target) return send(e,{type:"text",text:"メンションして"});
const rows=await getSheet("subs!A:B");
const filtered=rows.filter(x=>!(x[0]===g && x[1]===target));
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
if(!w) return send(e,{type:"text",text:"入力して"});
await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"ng!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,w]]}
});
return send(e,{type:"text",text:"追加OK"});
}

if(t.startsWith("NG削除")){
if(!(await isAdmin(g,u))) return send(e,{type:"text",text:"権限なし"});
const w=t.replace("NG削除","").trim();
const rows=await getSheet("ng!A:B");
const filtered=rows.filter(x=>!(x[0]===g && x[1]===w));
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
if(!(await isAdmin(g,u))) return send(e,{type:"text",text:"管理者のみ"});
const num=t.replace("連投制限","").trim();
await setSetting(g,num,set[2],set[3]);
return send(e,{type:"text",text:"設定OK"});
}

if(t==="状態確認"){
return send(e,{type:"text",text:`制限:${set[1]}\n挨拶:${set[2]}`});
}

// ===== 挨拶 =====
if(t==="挨拶ON"){
if(!(await isAdmin(g,u))) return send(e,{type:"text",text:"管理者のみ"});
await setSetting(g,set[1],"ON",set[3]);
return send(e,{type:"text",text:"ON"});
}
if(t==="挨拶OFF"){
if(!(await isAdmin(g,u))) return send(e,{type:"text",text:"管理者のみ"});
await setSetting(g,set[1],"OFF",set[3]);
return send(e,{type:"text",text:"OFF"});
}
if(t.startsWith("挨拶登録")){
if(!(await isAdmin(g,u))) return send(e,{type:"text",text:"管理者のみ"});
const txt=t.replace("挨拶登録","").trim();
if(!txt) return send(e,{type:"text",text:"入力して"});
await setSetting(g,set[1],set[2],txt);
return send(e,{type:"text",text:"登録OK"});
}
if(t==="挨拶確認"){
return send(e,{type:"text",text:`状態:${set[2]}\n内容:${set[3]}`});
}

}

}catch(err){
console.log("致命エラー:",err);
}

res.sendStatus(200);
});

app.listen(3000);
