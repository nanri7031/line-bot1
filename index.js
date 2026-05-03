import express from "express";
import * as line from "@line/bot-sdk";
import { google } from "googleapis";

const app = express();

// ===== LINE =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new line.Client(config);

// ===== Google =====
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// ===== 管理者 =====
const OWNER_ID = "U1a1aca9e44466f8cb05003d7dc86fee0";

// ===== userId取得（グループ対応） =====
async function getUserId(event) {
  if (event.source.userId) return event.source.userId;

  if (event.source.type === "group") {
    try {
      const profile = await client.getGroupMemberProfile(
        event.source.groupId,
        event.source.userId
      );
      return profile.userId;
    } catch {
      return null;
    }
  }
  return null;
}

// ===== 名前取得 =====
async function getName(userId) {
  try {
    const p = await client.getProfile(userId);
    return p.displayName;
  } catch {
    return "unknown";
  }
}

// ===== 管理者判定 =====
async function isAdmin(userId) {
  if (userId === OWNER_ID) return true;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "admins!A:B"
  });

  const rows = res.data.values || [];
  return rows.some(r => r[0] === userId);
}

// ===== 共通 =====
async function addRow(sheet, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A:B`,
    valueInputOption: "RAW",
    requestBody: { values: [values] }
  });
}

async function getList(sheet) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A:B`
  });
  return res.data.values || [];
}

async function deleteRow(sheet, target) {
  const rows = await getList(sheet);
  const newRows = rows.filter(r => r[0] !== target);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A:B`
  });

  if (newRows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheet}!A:B`,
      valueInputOption: "RAW",
      requestBody: { values: newRows }
    });
  }
}

// ===== メニュー =====
function menuFlex() {
  return {
    type: "flex",
    altText: "管理メニュー",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type:"text", text:"管理メニュー", size:"lg", weight:"bold", align:"center" },

          row("管理一覧","副管理一覧","#2563EB"),
          row("BAN一覧","NG一覧","#2563EB"),
          row("管理追加","管理削除","#60A5FA"),
          row("副管理追加","副管理削除","#60A5FA"),
          row("NG追加","通報","#EF4444"),
          row("解除","状態確認","#374151"),
          row("連投制限","挨拶ON","#60A5FA"),
          row("挨拶OFF","挨拶確認","#60A5FA")
        ]
      }
    }
  };
}

function row(a,b,color){
  return {
    type:"box",
    layout:"horizontal",
    spacing:"sm",
    contents:[btn(a,color),btn(b,color)]
  };
}

function btn(label,color){
  return {
    type:"button",
    style:"primary",
    color:color,
    flex:1,
    action:{type:"message",label,text:label}
  };
}

// ===== 一覧 =====
function listFlex(title,list,type){
  return {
    type:"flex",
    altText:title,
    contents:{
      type:"bubble",
      body:{
        type:"box",
        layout:"vertical",
        contents:[
          {type:"text",text:title,weight:"bold",size:"lg"},
          ...list.map(i=>({
            type:"box",
            layout:"horizontal",
            contents:[
              {type:"text",text:i[1]||i[0],flex:3},
              {
                type:"button",
                style:"secondary",
                action:{
                  type:"message",
                  label:"削除",
                  text:`${type}削除 ${i[0]}`
                }
              }
            ]
          }))
        ]
      }
    }
  };
}

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req,res)=>{
  for(const event of req.body.events){
    if(event.type !== "message") continue;

    const text = event.message.text;
    const userId = await getUserId(event);
    if(!userId) continue;

    if(text==="menu"){
      await client.replyMessage(event.replyToken,menuFlex());
      continue;
    }

    if(!(await isAdmin(userId))) continue;

    if(text==="ping"){
      await client.replyMessage(event.replyToken,{type:"text",text:"OK"});
    }

    if(text==="管理一覧"){
      const list = await getList("admins");
      await client.replyMessage(event.replyToken,listFlex("管理一覧",list,"管理"));
    }

    if(text==="副管理一覧"){
      const list = await getList("subs");
      await client.replyMessage(event.replyToken,listFlex("副管理一覧",list,"副管理"));
    }

    if(text==="NG一覧"){
      const list = await getList("ng");
      await client.replyMessage(event.replyToken,listFlex("NG一覧",list,"NG"));
    }

    if(text==="BAN一覧"){
      const list = await getList("ban");
      await client.replyMessage(event.replyToken,listFlex("BAN一覧",list,"BAN"));
    }

    if(text.startsWith("NG追加 ")){
      const word = text.replace("NG追加 ","").trim();
      if(!word) return;
      await addRow("ng",[word]);
      await client.replyMessage(event.replyToken,{type:"text",text:"NG追加 OK"});
    }

    if(text.startsWith("管理追加 ")){
      const id = text.replace("管理追加 ","").trim();
      const name = await getName(id);
      await addRow("admins",[id,name]);
      await client.replyMessage(event.replyToken,{type:"text",text:"管理追加 OK"});
    }

    if(text.startsWith("管理削除 ")){
      const id = text.replace("管理削除 ","").trim();
      await deleteRow("admins",id);
      await client.replyMessage(event.replyToken,{type:"text",text:"削除 OK"});
    }

    if(text.startsWith("副管理削除 ")){
      const id = text.replace("副管理削除 ","").trim();
      await deleteRow("subs",id);
      await client.replyMessage(event.replyToken,{type:"text",text:"削除 OK"});
    }

    if(text.startsWith("NG削除 ")){
      const word = text.replace("NG削除 ","").trim();
      await deleteRow("ng",word);
      await client.replyMessage(event.replyToken,{type:"text",text:"削除 OK"});
    }
  }

  res.sendStatus(200);
});

app.listen(3000,()=>console.log("RUNNING"));
