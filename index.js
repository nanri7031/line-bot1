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

// ===== 設定 =====
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

// ===== webhook =====
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

// 管理追加確定
if(d.startsWith("admin_add:")){
const id = d.split(":")[1];
await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"admins!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,id]]}
});
return send(e,{type:"text",text:"管理追加完了"});
}

// 管理削除
if(d.startsWith("admin_delete:")){
const id = d.split(":")[1];
const rows = await getSheet("admins!A:B");
await setSheet("admins!A:B",rows.filter(x=>!(x[0]===g && x[1]===id)));
return send(e,{type:"text",text:"管理削除完了"});
}

// 副管理削除
if(d.startsWith("sub_delete:")){
const id = d.split(":")[1];
const rows = await getSheet("subs!A:B");
await setSheet("subs!A:B",rows.filter(x=>!(x[0]===g && x[1]===id)));
return send(e,{type:"text",text:"副管理削除完了"});
}

// NG削除
if(d.startsWith("ng_delete:")){
const word = d.split(":")[1];
const rows = await getSheet("ng!A:B");
await setSheet("ng!A:B",rows.filter(x=>!(x[0]===g && x[1]===word)));
return send(e,{type:"text",text:"NG削除完了"});
}

// BAN解除
if(d.startsWith("ban_remove:")){
const id = d.split(":")[1];
const rows = await getSheet("ban!A:B");
await setSheet("ban!A:B",rows.filter(x=>!(x[0]===g && x[1]===id)));
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
// menu
// =====================
if(cmd==="menu"){
return send(e,{type:"text",text:"メニューOK"});
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
// 管理追加（確認）
// =====================
if(cmd.startsWith("管理追加")){
if(!admin) return send(e,{type:"text",text:"権限なし"});

const mention = e.message.mention?.mentionees?.[0]?.userId;
if(!mention) return send(e,{type:"text",text:"メンションして"});

return send(e,{
type:"template",
altText:"確認",
template:{
type:"confirm",
text:"管理追加しますか？",
actions:[
{type:"postback",label:"はい",data:`admin_add:${mention}`},
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

// =====================
// 管理一覧
// =====================
if(cmd==="管理一覧"){
const rows = await getSheet("admins!A:B");
const list = rows.filter(x=>x[0]===g);

if(!list.length) return send(e,{type:"text",text:"なし"});

return send(e,{type:"text",text:list.map(r=>r[1]).join("\n")});
}

// =====================
// 副管理一覧
// =====================
if(cmd==="副管理一覧"){
const rows = await getSheet("subs!A:B");
const list = rows.filter(x=>x[0]===g);

return send(e,{type:"text",text:list.map(r=>r[1]).join("\n")||"なし"});
}

// =====================
// NG追加
// =====================
if(cmd.startsWith("ng追加")){
const word = t.replace(/ng追加/i,"").trim();

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
const rows = await getSheet("ng!A:B");
const list = rows.filter(x=>x[0]===g);

return send(e,{type:"text",text:list.map(r=>r[1]).join("\n")||"なし"});
}

// =====================
// BAN追加
// =====================
if(cmd.startsWith("ban追加")){
const mention = e.message.mention?.mentionees?.[0]?.userId;
if(!mention) return send(e,{type:"text",text:"メンションして"});

await sheets.spreadsheets.values.append({
spreadsheetId:sheetId,
range:"ban!A:B",
valueInputOption:"RAW",
requestBody:{values:[[g,mention]]}
});

return send(e,{type:"text",text:"BAN完了"});
}

// =====================
// BAN一覧
// =====================
if(cmd==="ban一覧"){
const rows = await getSheet("ban!A:B");
const list = rows.filter(x=>x[0]===g);

return send(e,{type:"text",text:list.map(r=>r[1]).join("\n")||"なし"});
}

// =====================
// 挨拶登録
// =====================
if(cmd.startsWith("挨拶登録")){
const msg = t.replace("挨拶登録","").trim();
await setSheet("settings!A:D",[[g,"5","ON",msg]]);
return send(e,{type:"text",text:"挨拶登録OK"});
}

// =====================
// 挨拶確認
// =====================
if(cmd==="挨拶確認"){
const rows = await getSheet("settings!A:D");
const r = rows.find(x=>x[0]===g);

return send(e,{type:"text",text:r?.[3]||"未設定"});
}

}

}catch(err){
console.log(err);
}

res.sendStatus(200);
});

app.listen(3000);
