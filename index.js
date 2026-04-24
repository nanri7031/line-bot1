const line = require('@line/bot-sdk');
const express = require('express');
const fs = require('fs');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);
const app = express();

// ===== データ保存 =====
const FILE = './data.json';

let db = {
  MAIN_ADMIN: ['U1a1aca9e44466f8cb05003d7dc86fee0'],
  SUB_ADMIN: [],
  SUPPORT: [],
  bannedUsers: {},
  violationCount: {},
  emergencyMode: false
};

if (fs.existsSync(FILE)) {
  db = JSON.parse(fs.readFileSync(FILE));
}

function save() {
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

// ===== NG =====
const NG = ['死ね','バカ','消えろ','アホ'];

// ===== webhook =====
app.post('/webhook', line.middleware(config),(req,res)=>{
  Promise.all(req.body.events.map(handleEvent))
    .then(()=>res.json({}))
    .catch(console.error);
});

// ===== メイン処理 =====
async function handleEvent(event){

  if(event.type !== 'message') return;
  if(event.message.type !== 'text') return;

  const userId = event.source.userId;
  const text = event.message.text.trim();

  console.log("入力:", text);

  // ===== メニュー（最優先）=====
  if (
    text === 'メニュー' ||
    text.includes('メニュー') ||
    text === 'm'
  ) {
    return safeMenu(event.replyToken);
  }

  // ===== 緊急モード =====
  if(db.emergencyMode && !isAdmin(userId)){
    return reply(event.replyToken,'🚨緊急モード中');
  }

  // ===== BAN =====
  if(db.bannedUsers[userId]){
    return reply(event.replyToken,'🚫制限中');
  }

  // ===== 管理者一覧 =====
  if(text.includes('管理者一覧')){
    return showAdminList(event.replyToken);
  }

  // ===== NGワード =====
  if(NG.some(w => text.includes(w))){
    return violation(userId, event.replyToken);
  }

  // ===== 管理操作 =====
  if(text === '緊急ON'){
    if(!isAdmin(userId)) return;
    db.emergencyMode = true;
    save();
    return reply(event.replyToken,'🚨ON');
  }

  if(text === '緊急OFF'){
    if(!isAdmin(userId)) return;
    db.emergencyMode = false;
    save();
    return reply(event.replyToken,'🟢OFF');
  }
}

// ===== 違反 =====
function violation(id, token){
  db.violationCount[id] = (db.violationCount[id] || 0) + 1;

  if(db.violationCount[id] >= 3){
    db.bannedUsers[id] = true;
    save();
    return reply(token,'🚫制限');
  }

  save();
  return reply(token,'⚠️警告');
}

// ===== 管理者一覧 =====
async function showAdminList(token){

  async function name(id){
    try{
      const p = await client.getProfile(id);
      return p.displayName;
    }catch{
      return id;
    }
  }

  let txt = "👑本管理\n";
  for(let i of db.MAIN_ADMIN) txt += await name(i) + "\n";

  txt += "\n🔧副管理\n";
  for(let i of db.SUB_ADMIN) txt += await name(i) + "\n";

  txt += "\n🛠サポート\n";
  for(let i of db.SUPPORT) txt += await name(i) + "\n";

  return reply(token, txt);
}

// ===== メニュー（安全＋2列UI）=====
function safeMenu(token){
  try {
    return showMenu(token);
  } catch(e){
    console.log(e);
    return reply(token,'メニュー表示エラー');
  }
}

function showMenu(token){
  return client.replyMessage(token,{
    type:"flex",
    altText:"メニュー",
    contents:{
      type:"bubble",
      body:{
        type:"box",
        layout:"vertical",
        spacing:"md",
        contents:[
          row("👑 管理追加","⚠️ 通報"),
          row("📋 管理一覧","❌ 管理削除"),
          row("🔓 BAN解除","🚨 緊急ON"),
          row("🟢 緊急OFF","📜 ルール")
        ]
      }
    }
  });
}

// ===== UI =====
function row(a,b){
  return {
    type:"box",
    layout:"horizontal",
    spacing:"sm",
    contents:[
      btn(a),
      btn(b)
    ]
  };
}

function btn(text){
  return {
    type:"button",
    style:"primary",
    height:"sm",
    action:{
      type:"message",
      label:text,
      text: text.replace(/[👑⚠️📋❌🔓🚨🟢📜]/g,'').trim()
    }
  };
}

// ===== 共通 =====
function reply(token,text){
  return client.replyMessage(token,{type:'text',text});
}

function isAdmin(id){
  return db.MAIN_ADMIN.includes(id) || db.SUB_ADMIN.includes(id);
}

// ===== 起動 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT);
