const line = require('@line/bot-sdk');
const express = require('express');
const fs = require('fs');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);
const app = express();

// ===== データ =====
const FILE = './data.json';

let db = {
  MAIN_ADMIN: ['U1a1aca9e44466f8cb05003d7dc86fee0'],
  SUB_ADMIN: [],
  bannedUsers: {},
  violationCount: {},
  emergencyMode: false
};

if (fs.existsSync(FILE)) {
  db = JSON.parse(fs.readFileSync(FILE));
}

function save(){
  fs.writeFileSync(FILE, JSON.stringify(db,null,2));
}

// ===== 状態 =====
let pending = {};
let stampLog = {};

// ===== 設定 =====
const NG = ['死ね','バカ','消えろ','アホ'];
const STAMP_LIMIT = 3;
const STAMP_TIME = 5000;

// ===== webhook =====
app.post('/webhook', line.middleware(config),(req,res)=>{
  Promise.all(req.body.events.map(handleEvent))
    .then(()=>res.json({}))
    .catch(console.error);
});

// ===== メイン =====
async function handleEvent(event){

  const userId = event.source.userId;

  // ===== 新規参加 =====
  if(event.type === 'memberJoined'){
    return reply(event.replyToken,
`当グルに参加ありがとうございます😊
ルールを確認して下さい`);
  }

  // ===== スタンプ検知 =====
  if(event.type === 'message' && event.message.type === 'sticker'){
    const now = Date.now();

    stampLog[userId] = (stampLog[userId] || []).filter(t => now - t < STAMP_TIME);
    stampLog[userId].push(now);

    if(stampLog[userId].length >= STAMP_LIMIT){
      return punish(userId,event.replyToken,"スタンプ連打");
    }
    return;
  }

  if(event.type !== 'message') return;
  if(event.message.type !== 'text') return;

  const text = event.message.text.trim();

  // ===== メニュー =====
  if(text.includes('メニュー') || text === 'm'){
    return showMenu(event.replyToken);
  }

  // ===== 緊急 =====
  if(db.emergencyMode && !isAdmin(userId)){
    return reply(event.replyToken,'🚨緊急モード中');
  }

  // ===== BAN =====
  if(db.bannedUsers[userId]){
    return reply(event.replyToken,'🚫制限中');
  }

  // ===== NG =====
  if(NG.some(w => text.includes(w))){
    return punish(userId,event.replyToken,"NGワード");
  }

  // ===== 管理者一覧 =====
  if(text === '管理者一覧'){
    return reply(event.replyToken,JSON.stringify(db,null,2));
  }

  // ===== 緊急 =====
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

  // ===== 通報 =====
  if(text === '通報'){
    notifyAdmins(`🚨通報\nID:${userId}`);
    return reply(event.replyToken,'通報しました');
  }

  // ===== ID追加方式 =====
  if(text.startsWith('追加 ')){
    if(!isAdmin(userId)) return;

    const id = text.replace('追加 ','').trim();
    db.SUB_ADMIN.push(id);
    save();

    return reply(event.replyToken,'副管理追加');
  }

  if(text.startsWith('削除 ')){
    if(!isAdmin(userId)) return;

    const id = text.replace('削除 ','').trim();
    remove(id);
    save();

    return reply(event.replyToken,'削除');
  }

  if(text === '自分ID'){
    return reply(event.replyToken,userId);
  }
}

// ===== 違反 =====
function punish(id, token, reason){

  db.violationCount[id] = (db.violationCount[id]||0)+1;

  if(db.violationCount[id] >= 3){
    db.bannedUsers[id] = true;
    save();

    return reply(token,'🚫制限');
  }

  save();
  return reply(token,'⚠️警告');
}

// ===== メニュー（擬似リッチ）=====
function showMenu(token){
  return client.replyMessage(token,{
    type:"flex",
    altText:"メニュー",
    contents:{
      type:"bubble",
      hero:{
        type:"image",
        url:"https://via.placeholder.com/800x300.png?text=MENU",
        size:"full",
        aspectRatio:"20:13"
      },
      body:{
        type:"box",
        layout:"vertical",
        spacing:"md",
        contents:[
          row("👑 管理追加","⚠️ 通報"),
          row("📋 管理者一覧","❌ 管理削除"),
          row("🔓 BAN解除","🚨 緊急ON"),
          row("🟢 緊急OFF","🆔 自分ID")
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
    contents:[btn(a),btn(b)]
  };
}

function btn(text){
  return {
    type:"button",
    style:"primary",
    action:{
      type:"message",
      label:text,
      text:text.replace(/[👑⚠️📋❌🔓🚨🟢🆔]/g,'').trim()
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

function remove(id){
  db.SUB_ADMIN = db.SUB_ADMIN.filter(x=>x!==id);
}

function notifyAdmins(msg){
  db.MAIN_ADMIN.forEach(id=>{
    client.pushMessage(id,{type:'text',text:msg});
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT);
