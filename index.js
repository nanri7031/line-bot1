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
const DATA_FILE = './data.json';

let db = {
  MAIN_ADMIN: ['U1a1aca9e44466f8cb05003d7dc86fee0'],
  SUB_ADMIN: [],
  SUPPORT: [],
  bannedUsers: {},
  violationCount: {},
  emergencyMode: false
};

if (fs.existsSync(DATA_FILE)) {
  db = JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveDB(){
  fs.writeFileSync(DATA_FILE, JSON.stringify(db,null,2));
}

// ===== webhook =====
app.post('/webhook', line.middleware(config),(req,res)=>{
  Promise.all(req.body.events.map(handleEvent))
    .then(()=>res.json({}))
    .catch(console.error);
});

// ===== メイン =====
async function handleEvent(event){

  if(event.type!=='message') return;
  if(event.message.type!=='text') return;

  const userId = event.source.userId;
  const text = event.message.text.trim();

  console.log("入力:", JSON.stringify(text));

  // ===== メニュー（最優先）=====
  if (
    text === 'メニュー' ||
    text.includes('メニュー') ||
    text.toLowerCase() === 'menu' ||
    text === 'm'
  ) {
    return safeMenu(event.replyToken);
  }

  // ===== 管理者一覧 =====
  if(text.includes('管理者一覧')){
    return reply(event.replyToken,'管理者一覧OK');
  }

  return null;
}

// ===== 安全メニュー =====
function safeMenu(token){
  try {
    return showMenu(token);
  } catch (e) {
    console.log("Flexエラー:", e);
    return reply(token,'メニュー表示エラー（簡易表示）');
  }
}

// ===== メニュー（軽量安全版）=====
function showMenu(token){
  return client.replyMessage(token,{
    type:"flex",
    altText:"メニュー",
    contents:{
      type:"bubble",
      body:{
        type:"box",
        layout:"vertical",
        contents:[
          simpleBtn("管理追加"),
          simpleBtn("管理削除"),
          simpleBtn("管理者一覧"),
          simpleBtn("BAN解除"),
          simpleBtn("緊急ON"),
          simpleBtn("緊急OFF")
        ]
      }
    }
  });
}

// ===== 軽量ボタン =====
function simpleBtn(text){
  return {
    type:"button",
    action:{
      type:"message",
      label:text,
      text:text
    }
  };
}

// ===== 共通 =====
function reply(token,text){
  return client.replyMessage(token,{type:'text',text});
}

const PORT = process.env.PORT || 3000;
app.listen(PORT);
