import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import { google } from "googleapis";
import { Resend } from "resend";

const app = express();

const resend = new Resend(process.env.RESEND_API_KEY);

// ===== LINE =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new Client(config);

// ===== 重複防止 =====
const processed = new Set();

// ===== 安定返信 =====
const send = async (e, msg) => {
  try {
    await client.replyMessage(e.replyToken, msg);
  } catch (err) {
    console.log("reply失敗:", err);
  }
};

// ===== メール送信 =====
const sendMail = async(groupId,subject,text)=>{

try{

const rows = await getSheet("mail!A:C");

const mails =
rows
.filter(x =>
  String(x[0]).trim() ===
  String(groupId).trim()
)
.map(x => x[2])
.filter(Boolean);

console.log("SEND GROUP:", groupId);
console.log("MAIL ROWS:", rows);
console.log("TARGET MAILS:", mails);

if(!mails.length) return;

for(const mail of mails){

  try{

    const result =
  await resend.emails.send({
    from:"BOT通知 <onboarding@resend.dev>",
    to:[mail],
    subject,
    text
  });

console.log("MAIL RESULT:", result);

  }catch(err){

    console.log("MAIL ERR:", mail, err);

  }

}

console.log("MAIL送信OK");

}catch(err){

console.log("MAIL ERR",err);

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

// ===== 設定 =====
const OWNER = "U1a1aca9e44466f8cb05003d7dc86fee0";
const PASS = "1234";
const ADMIN_GROUP = "C3508f35d1033c94727550697070fb0b0";

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

// ===== webhook =====
app.post("/webhook", middleware(config), async (req,res)=>{
try{

for(const e of req.body.events){

// ===== 重複防止 =====
const eid =
  e.message?.id ||
  e.webhookEventId ||
  JSON.stringify(e);

if(processed.has(eid)) continue;
processed.add(eid);
if(processed.size > 5000) processed.clear();

// ===== グループ限定 =====
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

// 管理追加
if(d.startsWith("admin_add:")){
const id = d.split(":")[1];

const rows = await getSheet("admins!A:B");

// 重複防止
if(rows.some(x => x[0] === g && x[1] === id)){
  return send(e,{
    type:"text",
    text:"既に管理です"
  });
}

await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"admins!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,id]]}
});

return send(e,{
type:"text",
text:"管理追加完了"
});
}

// 管理削除
if(d.startsWith("admin_delete:")){

if(!admin){
  return send(e,{
    type:"text",
    text:"権限なし"
  });
}
const id = d.split(":")[1];
const rows = await getSheet("admins!A:B");
await setSheet("admins!A:B", rows.filter(x=>!(x[0]===g && x[1]===id)));
return send(e,{type:"text",text:"管理削除完了"});
}

// 副管理追加
if(d.startsWith("sub_add:")){

if(!admin){
  return send(e,{
    type:"text",
    text:"権限なし"
  });
}
const id = d.split(":")[1];

const rows = await getSheet("subs!A:B");

// 重複防止
if(rows.some(x => x[0] === g && x[1] === id)){
  return send(e,{
    type:"text",
    text:"既に副管理です"
  });
}

await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"subs!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,id]]}
});

return send(e,{
type:"text",
text:"副管理追加完了"
});
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

if(!admin && !sub){
  return send(e,{
    type:"text",
    text:"権限なし"
  });
}
const word = d.split(":")[1];
const rows = await getSheet("ng!A:B");
await setSheet("ng!A:B", rows.filter(x=>!(x[0]===g && x[1]===word)));
return send(e,{type:"text",text:"NG削除完了"});
}

// BAN解除
if(d.startsWith("ban_remove:")){

if(!admin){
  return send(e,{
    type:"text",
    text:"権限なし"
  });
}
const id = d.split(":")[1];
const rows = await getSheet("ban!A:B");
await setSheet("ban!A:B", rows.filter(x=>!(x[0]===g && x[1]===id)));
return send(e,{type:"text",text:"BAN解除完了"});
}
  
// black解除
if(d.startsWith("black_remove:")){

if(!admin){
  return send(e,{
    type:"text",
    text:"権限なし"
  });
}
const id = d.split(":")[1];

const rows = await getSheet("black!A:B");

await setSheet(
  "black!A:B",
  rows.filter(x => x[1] !== id)
);

return send(e,{
  type:"text",
  text:"black解除完了"
});
}
  
// 通報
if(d.startsWith("report:")){

const reason = d.split(":")[1];

console.log("REPORT", reason);

let name = u;

try{
  const p =
    await client.getGroupMemberProfile(g,u);

  name = p.displayName;
}catch{}

let groupName = g;

try{
  const summary =
    await client.getGroupSummary(g);

  groupName = summary.groupName;
}catch{}

try{

await sendMail(
  g,
  "通報通知",
  `通報通知

グループ:${groupName}

理由:${reason}

通報者:${name}

ユーザーID:${u}`
);

}catch(err){

console.log(err);

}

return send(e,{
  type:"text",
  text:"通報しました。"
});

}
} // ← POSTBACK終了

// =====================
// 退出検知
// =====================
if(e.type==="memberLeft"){

const leftUser =
  e.left?.members?.[0]?.userId;

if(!leftUser) continue;

let leftName = leftUser;

// activityから名前取得
const activityRows =
  await getSheet("activity!A:G");

const activityUser =
  activityRows.find(x =>
    x[0] === g &&
    x[1] === leftUser
  );

if(activityUser?.[2]){
  leftName = activityUser[2];
}

// =====================
// 退出ログ保存
// =====================
await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"leaveLog!A:D",
valueInputOption:"RAW",
requestBody:{
values:[[
new Date().toISOString(),
g,
leftUser,
leftName
]]
}
});

// =====================
// 管理者確認
// =====================
const adminRows =
  await getSheet("admins!A:B");

const subRows =
  await getSheet("subs!A:B");

const isLeftAdmin =
  adminRows.some(x =>
    x[0] === g &&
    x[1] === leftUser
  );

const isLeftSub =
  subRows.some(x =>
    x[0] === g &&
    x[1] === leftUser
  );

// =====================
// 解体検知
// =====================
global.leaveLogs ??= {};

if(!global.leaveLogs[g]){
  global.leaveLogs[g] = [];
}

const now = Date.now();

global.leaveLogs[g] =
  global.leaveLogs[g]
    .filter(x => now - x < 60000);

global.leaveLogs[g].push(now);

if(global.leaveLogs[g].length >= 3){

await client.pushMessage(g,{
type:"text",
text:
"⚠️ 短時間大量退出検知\n解体・荒らしの可能性があります"
});

}

// =====================
// 管理側退出警告
// =====================
if(isLeftAdmin || isLeftSub){

await client.pushMessage(g,{
type:"template",
altText:"管理側退出検知",
template:{
type:"buttons",
title:"⚠️ 管理側退出",
text:
`${leftName} が退出しました`,
actions:[

{
type:"message",
label:"通報",
text:"通報"
},

{
type:"message",
label:"BAN追加",
text:"BAN追加"
},

{
type:"message",
label:"black一覧",
text:"black一覧"
}

]
}
});

}

continue;
}
// =====================
// 新規参加挨拶
// =====================
if(e.type==="memberJoined"){

const rows = await getSheet("settings!A:D");

const setting =
  rows.find(x => x[0] === g);

if(setting?.[2] !== "ON") continue;

const msg =
  setting?.[3] || "ようこそ！";

await client.replyMessage(
  e.replyToken,
  {
    type:"text",
    text:msg
  }
);

continue;
}
  
// =====================
// MESSAGE
// =====================
if(e.type!=="message") continue;
  
const t = e.message.text?.trim() || "";

const cmd = t.toLowerCase();

// =====================
// 活動記録
// =====================

const activityRows =
  await getSheet("activity!A:G");

let userName = u;

try{
  const p =
    await client.getGroupMemberProfile(g,u);

  userName = p.displayName;
}catch{}

const nowDate =
  new Date().toISOString();

let foundRow = -1;

// 既存検索
for(let i=0;i<activityRows.length;i++){

  if(
    activityRows[i][0] === g &&
    activityRows[i][1] === u
  ){
    foundRow = i;
    break;
  }
}

// 既存更新
if(foundRow >= 0){

  const row =
    activityRows[foundRow];

  const total =
    Number(row[3] || 0) + 1;

  const week =
    Number(row[5] || 0) + 1;

  const month =
    Number(row[6] || 0) + 1;

  activityRows[foundRow] = [
    g,
    u,
    userName,
    total,
    nowDate,
    week,
    month
  ];

}else{

  // 新規追加
  activityRows.push([
    g,
    u,
    userName,
    1,
    nowDate,
    1,
    1
  ]);
}

// activity保存
await setSheet(
  "activity!A:G",
  activityRows
);
  
// ===== 管理コマンド一覧 =====
const adminCommands = [
"管理",
"副管理",
"ng",
"ban",
"black",
"連投",
"メール",
"挨拶",
"状態確認"
];

// 一般メンバー制限
if(
!admin &&
!sub &&
adminCommands.some(x => cmd.startsWith(x.toLowerCase()))
){
return send(e,{
type:"text",
text:"権限がありません"
});
}

// =====================
// 即BANワード
// =====================
const instantBanWords = [
  "死ね",
  "グロ",
  "詐欺"
];

// =====================
// NGワード監視
// =====================
const ngRows = await getSheet("ng!A:B");

const ngList = ngRows
  .filter(x => x[0] === g)
  .map(x => x[1]);

const hitWord = ngList.find(word =>
  t.includes(word)
);

if(
  hitWord &&
  !instantBanWords.some(word => t.includes(word))
){

  return send(e,{
    type:"text",
    text:`⚠️ NGワード検知\n「${hitWord}」`
  });
}

// =====================
// ブラックリスト
// =====================
const blackRows = await getSheet("black!A:B");

// =====================
// BAN確認
// =====================
const banRows = await getSheet("ban!A:B");

const isBanned = banRows.some(x =>
  x[0] === g && x[1] === u
);

global.banNotice ??= {};

if(isBanned){

  const key = `${g}_${u}`;

  if(!global.banNotice[key]){

    global.banNotice[key] = true;

    return send(e,{
      type:"text",
      text:"⚠️ BAN対象ユーザー\n管理者は退会処理してください"
    });
  }

  return;
}

const hitInstant = instantBanWords.find(word =>
  t.includes(word)
);

if(hitInstant){

  // BAN登録
  if(!banRows.some(x =>
  x[0] === g && x[1] === u
)){
  await sheets.spreadsheets.values.append({
    spreadsheetId:sheetId,
    range:"ban!A:B",
    valueInputOption:"RAW",
    requestBody:{
      values:[[g,u]]
    }
  });
}

  // ブラックリスト保存
  if(!blackRows.some(x => x[1] === u)){
    await sheets.spreadsheets.values.append({
      spreadsheetId:sheetId,
      range:"black!A:B",
      valueInputOption:"RAW",
      requestBody:{
        values:[[g,u]]
      }
    });
  }

  return send(e,{
    type:"text",
    text:`⚠️ 即BAN\n禁止ワード:${hitInstant}`
  });
}

// =====================
// 連投監視
// =====================
// 管理者は連投除外
if(!admin && !sub){

global.floodMap ??= {};

if(!global.floodMap[g]){
  global.floodMap[g] = {};
}

if(!global.floodMap[g][u]){
  global.floodMap[g][u] = [];
}

const now = Date.now();

// 10秒以内のみ保持
global.floodMap[g][u] =
  global.floodMap[g][u]
    .filter(time => now - time < 10000);

global.floodMap[g][u].push(now);

// settings取得
const settingRows = await getSheet("settings!A:D");

const setting =
  settingRows.find(x => x[0] === g);

const limit =
  Number(setting?.[1] || 5);

// 連投BAN
if(global.floodMap[g][u].length >= limit){

  if(!banRows.some(x =>
    x[0] === g && x[1] === u
  )){
    await sheets.spreadsheets.values.append({
      spreadsheetId:sheetId,
      range:"ban!A:B",
      valueInputOption:"RAW",
      requestBody:{
        values:[[g,u]]
      }
    });
  }

  if(!blackRows.some(x => x[1] === u)){
    await sheets.spreadsheets.values.append({
      spreadsheetId:sheetId,
      range:"black!A:B",
      valueInputOption:"RAW",
      requestBody:{
        values:[[g,u]]
      }
    });
  }

  return send(e,{
    type:"text",
    text:"⚠️ 連投BAN\n管理者は退会処理してください"
  });
}

}

// ===== GID取得 =====
if(cmd === "gid"){
  return send(e,{
    type:"text",
    text:`${g}`
  });
}
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
["BAN一覧","通報"],
["メール登録 test@test.com","メール確認"],
["メール削除","状態確認"],
["挨拶ON","挨拶OFF"],
["挨拶登録 ようこそ！","挨拶確認"]
].map(row=>({
type:"box",
layout:"horizontal",
contents:row.map(txt=>{
let color="#1565C0";
if(txt.includes("削除")||txt.includes("NG")) color="#D32F2F";
if(txt.includes("BAN")) color="#000000";
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
// 管理登録
// =====================
if(cmd.startsWith("管理登録")){
const pass = t.replace("管理登録","").trim();
if(pass!==PASS) return send(e,{type:"text",text:"パス違い"});
await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"admins!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,u]]}
});
return send(e,{type:"text",text:"管理登録OK"});
}

// =====================
// 管理追加
// =====================
if(cmd.startsWith("管理追加")){
if(!admin) return send(e,{type:"text",text:"権限なし"});
const id = e.message.mention?.mentionees?.[0]?.userId;
if(!id) return send(e,{type:"text",text:"メンションして"});
return send(e,{
type:"template",
altText:"確認",
template:{
type:"confirm",
text:"管理追加しますか？",
actions:[
{type:"postback",label:"はい",data:`admin_add:${id}`},
{type:"message",label:"いいえ",text:"キャンセル"}
]
}
});
}

// =====================
// 副管理追加
// =====================
if(cmd.startsWith("副管理追加")){
if(!admin) return send(e,{type:"text",text:"権限なし"});
const id = e.message.mention?.mentionees?.[0]?.userId;
if(!id) return send(e,{type:"text",text:"メンションして"});
return send(e,{
type:"template",
altText:"確認",
template:{
type:"confirm",
text:"副管理追加しますか？",
actions:[
{type:"postback",label:"はい",data:`sub_add:${id}`},
{type:"message",label:"いいえ",text:"キャンセル"}
]
}
});
}

// =====================
// 管理一覧
// =====================
if(cmd==="管理一覧"){
const rows=await getSheet("admins!A:B");
const list=rows.filter(x=>x[0]===g);
if(!list.length) return send(e,{type:"text",text:"なし"});

const contents=[];
for(const r of list){
let name=r[1];
try{
const p=await client.getGroupMemberProfile(g,r[1]);
name=p.displayName;
}catch{}

contents.push({
type:"box",
layout:"horizontal",
contents:[
{type:"text",text:name,flex:3,wrap:true},
{type:"button",style:"primary",color:"#D32F2F",action:{type:"postback",label:"削除",data:`admin_delete:${r[1]}`}}
]
});
}

return send(e,{
type:"flex",
altText:"管理一覧",
contents:{type:"bubble",body:{type:"box",layout:"vertical",contents:[
{type:"text",text:"管理一覧",weight:"bold"},
...contents
]}}
});
}

// =====================
// 副管理一覧
// =====================
if(cmd==="副管理一覧"){
const rows=await getSheet("subs!A:B");
const list=rows.filter(x=>x[0]===g);
if(!list.length) return send(e,{type:"text",text:"なし"});

const contents=[];
for(const r of list){
let name=r[1];
try{
const p=await client.getGroupMemberProfile(g,r[1]);
name=p.displayName;
}catch{}

contents.push({
type:"box",
layout:"horizontal",
contents:[
{type:"text",text:name,flex:3,wrap:true},
{type:"button",style:"primary",color:"#D32F2F",action:{type:"postback",label:"削除",data:`sub_delete:${r[1]}`}}
]
});
}

return send(e,{
type:"flex",
altText:"副管理一覧",
contents:{type:"bubble",body:{type:"box",layout:"vertical",contents:[
{type:"text",text:"副管理一覧",weight:"bold"},
...contents
]}}
});
}

// =====================
// 通報
// =====================
if(cmd==="通報"){

return send(e,{
type:"template",
altText:"通報",
template:{
type:"buttons",
title:"通報理由",
text:"理由を選択してください",
actions:[
{
type:"postback",
label:"荒らし",
data:"report:荒らし"
},
{
type:"postback",
label:"解体",
data:"report:解体"
},
{
type:"postback",
label:"ルール違反",
data:"report:ルール違反"
},
{
type:"postback",
label:"引抜き",
data:"report:引抜き"
}
]
}
});

}

// =====================
// NG追加
// =====================
if(cmd.startsWith("ng追加")){
if(!admin && !sub) return send(e,{type:"text",text:"権限なし"});
const word=t.replace(/ng追加/i,"").trim();

const rows = await getSheet("ng!A:B");
if(rows.some(x=>x[0]===g && x[1]===word)){
return send(e,{type:"text",text:"既に登録済み"});
}

await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"ng!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,word]]}
});
return send(e,{type:"text",text:"NG追加OK"});
}
// =====================
// NG一覧
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
{type:"button",style:"primary",color:"#D32F2F",action:{type:"postback",label:"削除",data:`ng_delete:${r[1]}`}}
]
}))
]
}
}
});
}

// =====================
// BAN追加
// =====================
if(cmd.startsWith("ban追加")){

if(!admin){
  return send(e,{
    type:"text",
    text:"権限なし"
  });
}

const id =
  e.message.mention?.mentionees?.[0]?.userId;

if(!id){
  return send(e,{
    type:"text",
    text:"メンションして"
  });
}

const rows = await getSheet("ban!A:B");

// 重複防止
if(rows.some(x => x[0] === g && x[1] === id)){
  return send(e,{
    type:"text",
    text:"既にBAN済み"
  });
}

await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"ban!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,id]]}
});

return send(e,{
type:"text",
text:"BAN完了"
});
}
// =====================
// BAN一覧
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
{type:"button",style:"primary",color:"#2E7D32",action:{type:"postback",label:"解除",data:`ban_remove:${r[1]}`}}
]
}))
]
}
}
});
}
  
// =====================
// black一覧
// =====================
if(cmd==="black一覧"){

const rows = await getSheet("black!A:B");

if(!rows.length){
  return send(e,{
    type:"text",
    text:"なし"
  });
}

return send(e,{
type:"flex",
altText:"black一覧",
contents:{
type:"bubble",
body:{
type:"box",
layout:"vertical",
contents:[
{type:"text",text:"black一覧",weight:"bold"},

...rows.map(r=>({
type:"box",
layout:"horizontal",
contents:[
{
type:"text",
text:r[1],
flex:3,
wrap:true
},
{
type:"button",
style:"primary",
color:"#2E7D32",
action:{
type:"postback",
label:"解除",
data:`black_remove:${r[1]}`
}
}
]
}))
]
}
}
});
}
// =====================
// 連投制限
// =====================
if(cmd.startsWith("連投制限")){
  if(!admin) return send(e,{type:"text",text:"権限なし"});

  const num = t.replace("連投制限","").trim();

  const rows = await getSheet("settings!A:D");

  let found = false;

  for(let i=0;i<rows.length;i++){
    if(rows[i][0] === g){
      rows[i] = [
        g,
        num,
        rows[i][2] || "OFF",
        rows[i][3] || ""
      ];
      found = true;
    }
  }

  if(!found){
    rows.push([g,num,"OFF",""]);
  }

  await setSheet("settings!A:D", rows);

  return send(e,{
    type:"text",
    text:`連投制限:${num}`
  });
}

// =====================
// 挨拶ON/OFF
// =====================
if(cmd==="挨拶on"){
  const rows = await getSheet("settings!A:D");

  let found = false;

  for(let i=0;i<rows.length;i++){
    if(rows[i][0] === g){
      rows[i] = [
        g,
        rows[i][1] || 5,
        "ON",
        rows[i][3] || ""
      ];
      found = true;
    }
  }

  if(!found){
    rows.push([g,5,"ON",""]);
  }

  await setSheet("settings!A:D", rows);

  return send(e,{
    type:"text",
    text:"挨拶ON"
  });
}

if(cmd==="挨拶off"){
  const rows = await getSheet("settings!A:D");

  let found = false;

  for(let i=0;i<rows.length;i++){
    if(rows[i][0] === g){
      rows[i] = [
        g,
        rows[i][1] || 5,
        "OFF",
        rows[i][3] || ""
      ];
      found = true;
    }
  }

  if(!found){
    rows.push([g,5,"OFF",""]);
  }

  await setSheet("settings!A:D", rows);

  return send(e,{
    type:"text",
    text:"挨拶OFF"
  });
}

// =====================
// 挨拶登録
// =====================
// 挨拶登録（修正版）
if(cmd.startsWith("挨拶登録")){
  const msg = t.replace("挨拶登録","").trim();

  const rows = await getSheet("settings!A:D");

  let found = false;

  for(let i=0;i<rows.length;i++){
    if(rows[i][0] === g){
      rows[i] = [
        g,
        rows[i][1] || 5,
        rows[i][2] || "ON",
        msg
      ];
      found = true;
    }
  }

  if(!found){
    rows.push([g,5,"ON",msg]);
  }

  await setSheet("settings!A:D", rows);

  return send(e,{
    type:"text",
    text:"挨拶登録OK"
  });
}

// =====================
// 挨拶確認
// =====================
if(cmd==="挨拶確認"){
  const rows = await getSheet("settings!A:D");
  const r = rows.find(x=>x[0]===g);

  return send(e,{
    type:"text",
    text:`挨拶:${r?.[2] || "OFF"}\n内容:${r?.[3] || "未設定"}`
  });
}
  
 // =====================
// メール登録
// =====================
if(cmd.startsWith("メール登録")){

if(!admin && !sub){
  return send(e,{
    type:"text",
    text:"権限なし"
  });
}

const mail =
  t.replace("メール登録","").trim();

if(!mail.includes("@")){
  return send(e,{
    type:"text",
    text:"メール形式エラー"
  });
}

const rows =
  await getSheet("mail!A:C");

// 重複更新
const filtered =
  rows.filter(x =>
    !(x[0]===g && x[1]===u)
  );

filtered.push([g,u,mail]);

await setSheet(
  "mail!A:C",
  filtered
);

return send(e,{
  type:"text",
  text:`メール登録完了\n${mail}`
});
}
  
// =====================
// メール確認
// =====================
if(cmd==="メール確認"){

  const rows = await getSheet("mail!A:C");

  const list = rows.filter(x =>
    x[0] === g && x[1] === u
  );

  if(!list.length){
    return send(e,{
      type:"text",
      text:"メール未登録"
    });
  }

  return send(e,{
    type:"text",
    text:`登録メール\n${list[0][2]}`
  });
}

// =====================
// メール削除
// =====================
if(cmd==="メール削除"){

  const rows = await getSheet("mail!A:C");

  await setSheet(
    "mail!A:C",
    rows.filter(x =>
      !(x[0] === g && x[1] === u)
    )
  );

  return send(e,{
    type:"text",
    text:"メール削除完了"
  });
}

// =====================
// 活動ランキング
// =====================
if(cmd==="活動ランキング"){

const rows =
  await getSheet("activity!A:G");

const list =
  rows
  .filter(x => x[0] === g)
  .sort((a,b)=>
    Number(b[3]) - Number(a[3])
  )
  .slice(0,10);

if(!list.length){
  return send(e,{
    type:"text",
    text:"データなし"
  });
}

const contents = list.map((r,i)=>{

const days =
Math.floor(
(
Date.now() -
new Date(r[4]).getTime()
)
/86400000
);

let medal = "🏅";

if(i===0) medal = "🥇";
if(i===1) medal = "🥈";
if(i===2) medal = "🥉";

return{
type:"box",
layout:"vertical",
margin:"lg",
paddingAll:"12px",
backgroundColor:"#FFF3E0",
cornerRadius:"12px",
contents:[

{
type:"text",
text:`${medal} ${i+1}位`,
weight:"bold",
color:"#E65100",
size:"sm"
},

{
type:"text",
text:r[2],
weight:"bold",
size:"lg",
margin:"sm",
wrap:true
},

{
type:"box",
layout:"baseline",
margin:"md",
contents:[
{
type:"text",
text:"発言",
size:"sm",
color:"#777777",
flex:2
},
{
type:"text",
text:`${r[3]}件`,
size:"sm",
color:"#FB8C00",
align:"end",
weight:"bold",
flex:3
}
]
},

{
type:"box",
layout:"baseline",
margin:"sm",
contents:[
{
type:"text",
text:"最終発言",
size:"sm",
color:"#777777",
flex:2
},
{
type:"text",
text:`${days}日前`,
size:"sm",
color:"#EF6C00",
align:"end",
weight:"bold",
flex:3
}
]
}

]
};

});

return send(e,{
type:"flex",
altText:"活動ランキング",
contents:{
type:"bubble",
hero:{
type:"box",
layout:"vertical",
backgroundColor:"#FB8C00",
paddingAll:"20px",
contents:[
{
type:"text",
text:"📊 活動ランキング",
color:"#FFFFFF",
weight:"bold",
size:"xl",
align:"center"
}
]
},
body:{
type:"box",
layout:"vertical",
contents
}
}
});
}

// =====================
// 未活動ランキング
// =====================
if(cmd==="未活動ランキング"){

const rows =
  await getSheet("activity!A:G");

const list =
  rows
  .filter(x => x[0] === g)
  .sort((a,b)=>
    new Date(a[4]) -
    new Date(b[4])
  )
  .slice(0,10);

if(!list.length){
  return send(e,{
    type:"text",
    text:"データなし"
  });
}

const contents = list.map((r,i)=>{

const days =
Math.floor(
(
Date.now() -
new Date(r[4]).getTime()
)
/86400000
);

return{
type:"box",
layout:"horizontal",
margin:"md",
contents:[
{
type:"text",
text:r[2],
flex:3,
wrap:true
},
{
type:"text",
text:`${days}日`,
flex:2,
align:"end",
color:"#E65100",
weight:"bold"
}
]
};

});

return send(e,{
type:"flex",
altText:"未活動ランキング",
contents:{
type:"bubble",
hero:{
type:"box",
layout:"vertical",
backgroundColor:"#FF9800",
paddingAll:"20px",
contents:[
{
type:"text",
text:"😴 未活動ランキング",
color:"#FFFFFF",
weight:"bold",
size:"xl",
align:"center"
}
]
},
body:{
type:"box",
layout:"vertical",
contents
}
}
});
}  

// =====================
// 週間ランキング
// =====================
if(cmd==="週間ランキング"){

const rows =
  await getSheet("activity!A:G");

const list =
  rows
  .filter(x => x[0] === g)
  .sort((a,b)=>
    Number(b[5]) - Number(a[5])
  )
  .slice(0,10);

if(!list.length){
  return send(e,{
    type:"text",
    text:"データなし"
  });
}

const contents = list.map((r,i)=>{

return{
type:"box",
layout:"horizontal",
margin:"md",
contents:[
{
type:"text",
text:`${i+1}位`,
flex:1,
color:"#FB8C00",
weight:"bold"
},
{
type:"text",
text:r[2],
flex:3,
wrap:true
},
{
type:"text",
text:`${r[5]}件`,
flex:2,
align:"end",
color:"#E65100",
weight:"bold"
}
]
};

});

return send(e,{
type:"flex",
altText:"週間ランキング",
contents:{
type:"bubble",
hero:{
type:"box",
layout:"vertical",
backgroundColor:"#FB8C00",
paddingAll:"20px",
contents:[
{
type:"text",
text:"🔥 週間ランキング",
color:"#FFFFFF",
weight:"bold",
size:"xl",
align:"center"
}
]
},
body:{
type:"box",
layout:"vertical",
contents
}
}
});
} 

// =====================
// 月間ランキング
// =====================
if(cmd==="月間ランキング"){

const rows =
  await getSheet("activity!A:G");

const list =
  rows
  .filter(x => x[0] === g)
  .sort((a,b)=>
    Number(b[6]) - Number(a[6])
  )
  .slice(0,10);

if(!list.length){
  return send(e,{
    type:"text",
    text:"データなし"
  });
}

const contents = list.map((r,i)=>{

return{
type:"box",
layout:"horizontal",
margin:"md",
contents:[
{
type:"text",
text:`${i+1}位`,
flex:1,
color:"#FB8C00",
weight:"bold"
},
{
type:"text",
text:r[2],
flex:3,
wrap:true
},
{
type:"text",
text:`${r[6]}件`,
flex:2,
align:"end",
color:"#E65100",
weight:"bold"
}
]
};

});

return send(e,{
type:"flex",
altText:"月間ランキング",
contents:{
type:"bubble",
hero:{
type:"box",
layout:"vertical",
backgroundColor:"#EF6C00",
paddingAll:"20px",
contents:[
{
type:"text",
text:"👑 月間ランキング",
color:"#FFFFFF",
weight:"bold",
size:"xl",
align:"center"
}
]
},
body:{
type:"box",
layout:"vertical",
contents
}
}
});
}

// =====================
// ROM専一覧
// =====================
if(t==="ROM専一覧"){

const rows =
  await getSheet("activity!A:G");

const list =
  rows.filter(r=>{

const days =
Math.floor(
(
Date.now() -
new Date(r[4]).getTime()
)
/86400000
);

return days >= 30;

});

if(!list.length){
  return send(e,{
    type:"text",
    text:"ROM専なし"
  });
}

const contents = list.map(r=>{

const days =
Math.floor(
(
Date.now() -
new Date(r[4]).getTime()
)
/86400000
);

return{
type:"box",
layout:"horizontal",
margin:"md",
contents:[
{
type:"text",
text:r[2],
flex:3,
wrap:true
},
{
type:"text",
text:`${days}日`,
flex:2,
align:"end",
color:"#D84315",
weight:"bold"
}
]
};

});

return send(e,{
type:"flex",
altText:"ROM専一覧",
contents:{
type:"bubble",
hero:{
type:"box",
layout:"vertical",
backgroundColor:"#F57C00",
paddingAll:"20px",
contents:[
{
type:"text",
text:"👻 ROM専一覧",
color:"#FFFFFF",
weight:"bold",
size:"xl",
align:"center"
}
]
},
body:{
type:"box",
layout:"vertical",
contents
}
}
});
}
  
// =====================
// 状態確認
// =====================
if(cmd==="状態確認"){
const rows = await getSheet("settings!A:D");
const r = rows.find(x=>x[0]===g);
return send(e,{type:"text",text:`連投制限:${r?.[1]||5}\n挨拶:${r?.[2]||"OFF"}`});
}

}

}catch(err){
console.log("ERR:",err);
}

res.sendStatus(200);
});

app.listen(3000);
