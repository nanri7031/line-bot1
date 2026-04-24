const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');

const config = {
  channelAccessToken: process.env.ACCESS_TOKEN,
  channelSecret: process.env.SECRET
};

const app = express();
const client = new line.Client(config);

// ===== DB =====
let db = { users:{}, blacklist:[] };

if(fs.existsSync('db.json')){
  db = JSON.parse(fs.readFileSync('db.json'));
}

function save(){
  fs.writeFileSync('db.json', JSON.stringify(db,null,2));
}

// ===== 管理者 =====
let adminData = {
  owner: ['ここにあなたのID'],
  admin: []
};

const isOwner = id => adminData.owner.includes(id);
const isAdmin = id => isOwner(id) || adminData.admin.includes(id);

// ===== 状態 =====
let leaveLog = [];
let emergency = false;
let timer = null;

// ===== Webhook =====
app.post('/webhook', line.middleware(config),(req,res)=>{
  Promise.all(req.body.events.map(handleEvent)).then(()=>res.end());
});

// ===== メイン =====
async function handleEvent(event){

  const userId = event.source.userId;
  const groupId = event.source.groupId;
  const now = Date.now();

  // ===== 初期登録 =====
  if(!db.users[userId]){
    const p = await client.getProfile(userId);
    db.users[userId] = {
      name:p.displayName,
      warns:0,
      lastMsg:'',
      lastTime:0,
      stamp:0,
      lastStamp:0
    };
    save();
  }

  const user = db.users[userId];

  // ===== 参加 =====
  if(event.type === 'memberJoined'){
    const id = event.joined.members[0].userId;

    if(db.blacklist.includes(id)){
      await client.kickoutFromGroup(groupId,[id]);
      return;
    }

    const p = await client.getGroupMemberProfile(groupId,id);
    return reply(event,`@${p.displayName} ようこそ！`);
  }

  // ===== 解体検知 =====
  if(event.type === 'memberLeft'){
    leaveLog.push(now);
    leaveLog = leaveLog.filter(t => now - t < 10000);

    if(leaveLog.length >= 5 && !emergency){
      emergency = true;
      notifyAdmins('🚨 解体検知！緊急モードON');

      clearTimeout(timer);
      timer = setTimeout(()=>{
        emergency = false;
        notifyAdmins('🟢 自動解除');
      }, 30*60*1000);
    }
    return;
  }

  // ===== メニュー表示 =====
  if(event.type === 'message'){
    return showMenu(event);
  }

  // ===== ボタン処理 =====
  if(event.type === 'postback'){

    const data = event.postback.data;

    if(data === 'menu') return showMenu(event);
    if(data === 'users:0') return showUsers(event,0);
    if(data === 'admins') return showAdmins(event);
    if(data === 'addAdmin') return showAddAdmin(event);
    if(data === 'myid') return reply(event,`あなたのID: ${userId}`);

    // ===== 緊急モード =====
    if(data === 'emergencyOn'){
      if(!isAdmin(userId)) return;
      emergency = true;
      notifyAdmins('🚨 手動で緊急モードON');
      return reply(event,'ON');
    }

    if(data === 'emergencyOff'){
      if(!isAdmin(userId)) return;
      emergency = false;
      leaveLog = [];
      notifyAdmins('🟢 手動解除');
      return reply(event,'解除');
    }

    // ページ
    if(data.startsWith('users:')){
      const page = Number(data.split(':')[1]);
      return showUsers(event,page);
    }

    // 操作
    const [action,id] = data.split(':');

    if(!isAdmin(userId)) return;

    if(action === 'warn') db.users[id].warns++;
    if(action === 'ban'){
      if(!db.blacklist.includes(id)) db.blacklist.push(id);
    }
    if(action === 'unban'){
      db.blacklist = db.blacklist.filter(v => v !== id);
    }
    if(action === 'kick'){
      await client.kickoutFromGroup(groupId,[id]);
    }
    if(action === 'addSub'){
      if(isOwner(userId)) adminData.admin.push(id);
    }
    if(action === 'addOwner'){
      if(isOwner(userId)) adminData.owner.push(id);
    }

    save();
    return reply(event,'完了');
  }

  // ===== 自動キック =====
  if(event.type === 'message'){

    const text = event.message.text;

    if(text && ['アホ','バカ','死ね'].some(w=>text.includes(w))){
      if(!isAdmin(userId)){
        db.blacklist.push(userId);
        save();
        return client.kickoutFromGroup(groupId,[userId]);
      }
    }

    if(emergency && !isAdmin(userId)){
      return client.kickoutFromGroup(groupId,[userId]);
    }

    if(text === user.lastMsg && now - user.lastTime < 3000){
      user.warns++;
    }

    user.lastMsg = text;
    user.lastTime = now;

    if(user.warns >= 3 && !isAdmin(userId)){
      return client.kickoutFromGroup(groupId,[userId]);
    }
  }

  // ===== スタンプ =====
  if(event.message?.type === 'sticker'){
    if(now - user.lastStamp < 3000){
      user.stamp++;
    } else {
      user.stamp = 1;
    }

    user.lastStamp = now;

    if(user.stamp >= 3 && !isAdmin(userId)){
      return client.kickoutFromGroup(groupId,[userId]);
    }
  }
}

// ===== メニュー =====
function showMenu(event){
  return client.replyMessage(event.replyToken,{
    type:'flex',
    altText:'menu',
    contents:{
      type:'bubble',
      body:{
        type:'box',
        layout:'vertical',
        contents:[
          btn('👥 ユーザー','users:0'),
          btn('👑 管理者','admins'),
          btn('🆔 ID','myid'),
          btn('🚨 緊急ON','emergencyOn'),
          btn('🟢 緊急解除','emergencyOff')
        ]
      }
    }
  });
}

// ===== ユーザー一覧 =====
function showUsers(event,page){
  const list = Object.entries(db.users);
  const per = 10;
  const slice = list.slice(page*per,(page+1)*per);

  const bubbles = slice.map(([id,u])=>({
    type:'bubble',
    body:{
      type:'box',
      layout:'vertical',
      contents:[
        {type:'text',text:u.name},
        {type:'text',text:`警告:${u.warns}`},
        {
          type:'box',
          layout:'horizontal',
          contents:[
            btn('警告',`warn:${id}`),
            btn('BAN',`ban:${id}`),
            btn('解除',`unban:${id}`),
            btn('キック',`kick:${id}`)
          ]
        }
      ]
    }
  }));

  bubbles.push({
    type:'bubble',
    body:{
      type:'box',
      layout:'horizontal',
      contents:[
        btn('⬅️',`users:${page-1}`),
        btn('➡️',`users:${page+1}`)
      ]
    }
  });

  return client.replyMessage(event.replyToken,{
    type:'flex',
    altText:'users',
    contents:{type:'carousel',contents:bubbles}
  });
}

// ===== 管理者 =====
function showAdmins(event){
  return client.replyMessage(event.replyToken,{
    type:'flex',
    altText:'admins',
    contents:{
      type:'bubble',
      body:{
        type:'box',
        layout:'vertical',
        contents:[
          {type:'text',text:'本管理'},
          {type:'text',text:adminData.owner.join('\n')},
          {type:'text',text:'副管理'},
          {type:'text',text:adminData.admin.join('\n')},
          btn('➕追加','addAdmin')
        ]
      }
    }
  });
}

// ===== 管理者追加 =====
function showAddAdmin(event){
  const bubbles = Object.entries(db.users).map(([id,u])=>({
    type:'bubble',
    body:{
      type:'box',
      layout:'vertical',
      contents:[
        {type:'text',text:u.name},
        {
          type:'box',
          layout:'horizontal',
          contents:[
            btn('副管理',`addSub:${id}`),
            btn('本管理',`addOwner:${id}`)
          ]
        }
      ]
    }
  }));

  return client.replyMessage(event.replyToken,{
    type:'flex',
    altText:'add',
    contents:{type:'carousel',contents:bubbles}
  });
}

// ===== ボタン =====
function btn(label,data){
  return {type:'button',action:{type:'postback',label,data}};
}

// ===== 返信 =====
function reply(event,text){
  return client.replyMessage(event.replyToken,{type:'text',text});
}

// ===== 通知 =====
function notifyAdmins(text){
  [...adminData.owner,...adminData.admin].forEach(id=>{
    client.pushMessage(id,{type:'text',text});
  });
}

app.listen(3000);
