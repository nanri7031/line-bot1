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
  SUPPORT: [],
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
const STAMP_LIMIT = 3;      // 何回で検知
const STAMP_TIME = 5000;   // 秒（5秒）

const NG = ['死ね','バカ','消えろ','アホ'];

// ===== webhook =====
app.post('/webhook', line.middleware(config),(req,res)=>{
  Promise.all(req.body.events.map(handleEvent))
    .then(()=>res.json({}))
    .catch(console.error);
});

// ===== メイン =====
async function handleEvent(event){

  const userId = event.source.userId;

  // ===== 参加挨拶 =====
  if (event.type === 'memberJoined') {
    return reply(event.replyToken,
`当グルに参加ありがとうございます😊

まずノートのルールを読んで下さい
読んだらイイねお願いします！`);
  }

  // ===== スタンプ検知 =====
  if(event.type === 'message' && event.message.type === 'sticker'){

    const now = Date.now();

    stampLog[userId] = (stampLog[userId] || []).filter(t => now - t < STAMP_TIME);
    stampLog[userId].push(now);

    if(stampLog[userId].length >= STAMP_LIMIT){
      return punish(userId, event.replyToken, "スタンプ連打");
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
    return punish(userId, event.replyToken, "NGワード");
  }

  // ===== 管理者一覧 =====
  if(text.includes('管理者一覧')){
    return adminList(event.replyToken);
  }

  // ===== 管理操作 =====
  if(text === '管理追加'){
    if(!isAdmin(userId)) return;
    pending[userId] = 'add';
    return reply(event.replyToken,'追加したい人に返信');
  }

  if(text === '管理削除'){
    if(!isAdmin(userId)) return;
    pending[userId] = 'remove';
    return reply(event.replyToken,'削除したい人に返信');
  }

  if(text === 'BAN解除'){
    if(!isAdmin(userId)) return;
    pending[userId] = 'unban';
    return reply(event.replyToken,'解除したい人に返信');
  }

  // ===== 緊急ON/OFF =====
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

  // ===== 対象取得 =====
  let targetId = null;

  if(event.message.mentions && event.message.mentions.mentionees.length > 0){
    targetId = event.message.mentions.mentionees[0].userId;
  }

  if(event.message.quoteToken){
    targetId = event.source.userId;
  }

  // ===== 実行 =====
  if(targetId && pending[userId]){

    if(targetId === userId){
      return reply(event.replyToken,'自分は対象不可');
    }

    if(pending[userId] === 'add'){
      if(!db.SUB_ADMIN.includes(targetId)){
        db.SUB_ADMIN.push(targetId);
      }
      save();
      pending[userId] = null;
      return reply(event.replyToken,'副管理追加');
    }

    if(pending[userId] === 'remove'){
      remove(targetId);
      save();
      pending[userId] = null;
      return reply(event.replyToken,'削除');
    }

    if(pending[userId] === 'unban'){
      delete db.bannedUsers[targetId];
      db.violationCount[targetId] = 0;
      save();
      pending[userId] = null;
      return reply(event.replyToken,'解除');
    }
  }
}

// ===== 処罰 =====
function punish(id, token, reason){

  db.violationCount[id] = (db.violationCount[id] || 0) + 1;

  notifyAdmins(`⚠️違反\n理由:${reason}\nID:${id}`);

  if(db.violationCount[id] >= 3){
    db.bannedUsers[id] = true;
    save();

    kickUser(id);

    return reply(token,'🚫強制退会');
  }

  save();
  return reply(token,'⚠️警告');
}

// ===== キック =====
function kickUser(userId){
  try{
    client.leaveGroup(userId); // ※制限あり
  }catch(e){
    console.log("キック失敗", e);
  }
}

// ===== 管理者一覧 =====
async function adminList(token){

  let txt = "👑本管理\n";
  db.MAIN_ADMIN.forEach(id => txt += id+"\n");

  txt += "\n🔧副管理\n";
  db.SUB_ADMIN.forEach(id => txt += id+"\n");

  return reply(token, txt);
}

// ===== メニュー =====
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
          row("📋 管理者一覧","❌ 管理削除"),
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
      text:text.replace(/[👑⚠️📋❌🔓🚨🟢📜]/g,'').trim()
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
  ['MAIN_ADMIN','SUB_ADMIN','SUPPORT'].forEach(k=>{
    db[k] = db[k].filter(x=>x!==id);
  });
}

function notifyAdmins(msg){
  db.MAIN_ADMIN.forEach(id=>{
    client.pushMessage(id,{type:'text',text:msg});
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT);
