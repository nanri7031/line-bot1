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

// ===== 状態 =====
let pendingAction = {};
let pendingRole = {};

// ===== NG =====
const NG_WORDS = ['死ね','バカ','消えろ','アホ'];

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

  console.log("受信:", text);

  // 緊急モード
  if(db.emergencyMode && !isAdmin(userId)){
    return reply(event.replyToken,'🚨緊急モード中');
  }

  // BAN
  if(db.bannedUsers[userId]){
    return reply(event.replyToken,'🚫制限中');
  }

  // ===== メニュー（対策版）=====
  if(text.includes('メニュー')){
    return showMenu(event.replyToken);
  }

  // ===== 管理者一覧 =====
  if(text.includes('管理者一覧')){
    return showAdminList(event.replyToken);
  }

  // ===== NG =====
  if(NG_WORDS.some(w=>text.includes(w))){
    return violation(event,userId,text);
  }

  // ===== 管理系 =====
  if(text==='管理追加'){
    if(!isAdmin(userId)) return;
    pendingAction[userId]='add';
    return showRoleMenu(event.replyToken);
  }

  if(text==='管理削除'){
    if(!isAdmin(userId)) return;
    pendingAction[userId]='remove';
    return reply(event.replyToken,'@対象指定');
  }

  if(text==='BAN解除'){
    if(!isAdmin(userId)) return;
    pendingAction[userId]='unban';
    return reply(event.replyToken,'@対象指定');
  }

  if(text==='緊急ON'){
    if(!isAdmin(userId)) return;
    db.emergencyMode=true;
    saveDB();
    notifyAdmins('🚨緊急ON');
    return reply(event.replyToken,'ON');
  }

  if(text==='緊急OFF'){
    if(!isAdmin(userId)) return;
    db.emergencyMode=false;
    saveDB();
    notifyAdmins('🟢解除');
    return reply(event.replyToken,'OFF');
  }

  if(['本管理','副管理','サポート'].includes(text)){
    if(pendingAction[userId]!=='add') return;
    pendingRole[userId]=text;
    return reply(event.replyToken,'@指定');
  }

  // ===== メンション =====
  let targetId=null;
  if(event.message.mentions){
    targetId=event.message.mentions.mentionees[0].userId;
  }

  if(targetId && pendingAction[userId]){

    const action=pendingAction[userId];
    const role=pendingRole[userId];

    if(action==='add'){
      db[roleMap(role)].push(targetId);
      saveDB();
      clearPending(userId);
      return reply(event.replyToken,'追加');
    }

    if(action==='remove'){
      removeUser(targetId);
      saveDB();
      clearPending(userId);
      return reply(event.replyToken,'削除');
    }

    if(action==='unban'){
      delete db.bannedUsers[targetId];
      db.violationCount[targetId]=0;
      saveDB();
      clearPending(userId);
      return reply(event.replyToken,'解除');
    }
  }
}

// ===== 違反 =====
function violation(event,userId,text){

  db.violationCount[userId]=(db.violationCount[userId]||0)+1;

  notifyAdmins(`⚠️違反\n${text}`);

  if(db.violationCount[userId]>=3){
    db.bannedUsers[userId]=true;
    notifyAdmins('🚫BAN');
    saveDB();
    return reply(event.replyToken,'制限');
  }

  saveDB();
  return reply(event.replyToken,'警告');
}

// ===== 管理者一覧 =====
async function showAdminList(token){

  async function name(id){
    try{return (await client.getProfile(id)).displayName;}
    catch{return id;}
  }

  let txt="👑本管理\n";
  for(let i of db.MAIN_ADMIN) txt+=await name(i)+"\n";

  txt+="\n🔧副管理\n";
  for(let i of db.SUB_ADMIN) txt+=await name(i)+"\n";

  txt+="\n🛠サポート\n";
  for(let i of db.SUPPORT) txt+=await name(i)+"\n";

  return reply(token,txt);
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
          row2("👑","管理追加","#4A90E2","⚠️","通報","#FF4D4F"),
          row2("📋","管理一覧","#36CFC9","❌","管理削除","#722ED1"),
          row2("🔓","BAN解除","#FA8C16","🚨","緊急ON","#FF0000"),
          row2("🟢","緊急OFF","#00AA00","📜","ルール","#2F54EB")
        ]
      }
    }
  });
}

// ===== UI =====
function row2(i1,t1,c1,i2,t2,c2){
  return {
    type:"box",
    layout:"horizontal",
    spacing:"sm",
    contents:[
      panel(i1,t1,c1),
      panel(i2,t2,c2)
    ]
  };
}

function panel(icon,text,color){
  return {
    type:"box",
    layout:"vertical",
    backgroundColor:color,
    cornerRadius:"md",
    paddingAll:"10px",
    alignItems:"center",
    justifyContent:"center",
    height:"80px",
    contents:[
      {type:"text",text:icon,size:"lg"},
      {type:"text",text:text,size:"xs",color:"#fff"}
    ],
    action:{
      type:"message",
      label:text,
      text:text==="管理一覧"?"管理者一覧":text
    }
  };
}

function showRoleMenu(token){
  return client.replyMessage(token,{
    type:"flex",
    altText:"役職",
    contents:{
      type:"bubble",
      body:{
        type:"box",
        layout:"vertical",
        contents:[
          btn("本管理"),
          btn("副管理"),
          btn("サポート")
        ]
      }
    }
  });
}

function btn(text){
  return {type:"button",action:{type:"message",label:text,text:text}};
}

// ===== 共通 =====
function reply(token,text){
  return client.replyMessage(token,{type:'text',text});
}

function isAdmin(id){
  return db.MAIN_ADMIN.includes(id)||db.SUB_ADMIN.includes(id);
}

function removeUser(id){
  ['MAIN_ADMIN','SUB_ADMIN','SUPPORT'].forEach(k=>{
    db[k]=db[k].filter(x=>x!==id);
  });
}

function roleMap(r){
  return r==="本管理"?"MAIN_ADMIN":r==="副管理"?"SUB_ADMIN":"SUPPORT";
}

function clearPending(id){
  delete pendingAction[id];
  delete pendingRole[id];
}

function notifyAdmins(msg){
  db.MAIN_ADMIN.forEach(id=>{
    client.pushMessage(id,{type:'text',text:msg});
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT);
