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

// ===== 送信安定 =====
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
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range
  });
  return res.data.values || [];
};

// ===== 上書き保存（重要）=====
const setSheet = async (range, values) => {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range
  });
  if (values.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values }
    });
  }
};

// ===== 管理判定 =====
async function isAdmin(g, u) {
  if (u === OWNER) return true;
  const r = await getSheet("admins!A:B");
  return r.some(x => x[0] === g && x[1] === u);
}

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req, res) => {

try {

for (const e of req.body.events) {

if (!e.source.groupId) continue;

const g = e.source.groupId;
const u = e.source.userId;

// ===== BAN制御 =====
const isAdminUser = await isAdmin(g, u);
const banList = await getSheet("ban!A:B");
const banned = banList.some(x => x[0] === g && x[1] === u);

if (e.type !== "postback" && banned && !isAdminUser) {
  await send(e, { type: "text", text: "🚫 利用制限中" });
  continue;
}

// ===== postback =====
if (e.type === "postback") {

const d = e.postback.data;

// ===== 管理削除 =====
if (d.startsWith("admin_delete:")) {
  const id = d.split(":")[1];
  const rows = await getSheet("admins!A:B");
  const filtered = rows.filter(x => !(x[0] === g && x[1] === id));
  await setSheet("admins!A:B", filtered);
  return send(e, { type: "text", text: "削除完了" });
}

// ===== BAN追加 =====
if (d.startsWith("ban_add:")) {
  const id = d.split(":")[1];
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "ban!A:B",
    valueInputOption: "RAW",
    requestBody: { values: [[g, id]] }
  });
  return send(e, { type: "text", text: "BAN完了" });
}

// ===== BAN解除 =====
if (d.startsWith("ban_remove:")) {
  const id = d.split(":")[1];
  const rows = await getSheet("ban!A:B");
  const filtered = rows.filter(x => !(x[0] === g && x[1] === id));
  await setSheet("ban!A:B", filtered);
  return send(e, { type: "text", text: "BAN解除" });
}

// ===== NG削除 =====
if (d.startsWith("ng_delete:")) {
  const word = d.split(":")[1];
  const rows = await getSheet("ng!A:B");
  const filtered = rows.filter(x => !(x[0] === g && x[1] === word));
  await setSheet("ng!A:B", filtered);
  return send(e, { type: "text", text: "NG削除" });
}

}

// ===== メッセージ =====
if (e.type !== "message" || e.message.type !== "text") continue;

const t = e.message.text.trim();

// ===== メニュー =====
if (t === "menu") {
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
if (t === "状態確認") {
  return send(e,{
    type:"text",
    text:"📊 状態\n連投制限:5\n挨拶:ON"
  });
}

// ===== 管理一覧 =====
if (t === "管理一覧") {
const rows = await getSheet("admins!A:B");
const list = rows.filter(x => x[0] === g);

if (list.length === 0) return send(e,{type:"text",text:"なし"});

const contents = [];

for (const r of list) {
let name = r[1];
try {
const p = await client.getGroupMemberProfile(g, r[1]);
name = p.displayName;
} catch {}

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
action:{type:"postback",label:"削除",data:`admin_delete:${r[1]}`}
},
{
type:"button",
style:"primary",
color:"#000000",
action:{type:"postback",label:"BAN",data:`ban_add:${r[1]}`}
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
if (t === "NG一覧") {
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

// ===== BAN一覧 =====
if (t === "BAN一覧") {
const rows = await getSheet("ban!A:B");
const list = rows.filter(x=>x[0]===g);

if(list.length===0) return send(e,{type:"text",text:"なし"});

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

}

} catch (err) {
console.log("エラー:", err);
}

res.sendStatus(200);
});

app.listen(3000);
