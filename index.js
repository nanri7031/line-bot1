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
const DATA_FILE = './data.json';

let db = {
  MAIN_ADMIN: ['U1a1aca9e44466f8cb05003d7dc86fee0'],
  SUB_ADMIN: [],
  SUPPORT: [],
  bannedUsers: {},
  violationCount: {}
};

if (fs.existsSync(DATA_FILE)) {
  db = JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveDB() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ===== 状態 =====
let pendingAction = {};
let pendingRole = {};

// ===== NGワード =====
const NG_WORDS = ['死ね','バカ','消えろ','アホ'];

// ===== webhook =====
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.json({ success: true }))
    .catch(err => console.error(err));
});

// ===== メイン処理 =====
async function handleEvent(event) {

  const userId = event.source.userId;

  if (db.bannedUsers[userId]) {
    return reply(event.replyToken, '🚫制限中');
  }

  if (event.type !== 'message') return null;
  if (event.message.type !== 'text') return null;

  const text = event.message.text;

  // NGワード
  if (NG_WORDS.some(w => text.includes(w))) {
    return violation(event, userId);
  }

  // メニュー
  if (text === 'メニュー') return showMenu(event.replyToken);

  // 管理者一覧
  if (text === '管理者一覧') {
    return showAdminList(event.replyToken);
  }

  // 管理追加
  if (text === '管理追加') {
    if (!isAdmin(userId)) return;
    pendingAction[userId] = 'add';
    return showRoleMenu(event.replyToken);
  }

  // 管理削除
  if (text === '管理削除') {
    if (!isAdmin(userId)) return;
    pendingAction[userId] = 'remove';
    return reply(event.replyToken, '削除する人を@メンションしてください');
  }

  // BAN解除
  if (text === 'BAN解除') {
    if (!isAdmin(userId)) return;
    pendingAction[userId] = 'unban';
    return reply(event.replyToken, '解除する人を@メンションしてください');
  }

  // 役職選択
  if (['本管理','副管理','サポート'].includes(text)) {
    if (pendingAction[userId] !== 'add') return;
    pendingRole[userId] = text;
    return reply(event.replyToken, '追加する人を@メンションしてください');
  }

  // ===== メンション取得 =====
  let targetId = null;

  if (event.message.mentions) {
    targetId = event.message.mentions.mentionees[0].userId;
  }

  if (targetId && pendingAction[userId]) {

    const action = pendingAction[userId];
    const role = pendingRole[userId];

    // 追加
    if (action === 'add') {
      if (role === '本管理') db.MAIN_ADMIN.push(targetId);
      if (role === '副管理') db.SUB_ADMIN.push(targetId);
      if (role === 'サポート') db.SUPPORT.push(targetId);

      saveDB();
      delete pendingAction[userId];
      delete pendingRole[userId];

      return reply(event.replyToken, '✅追加完了');
    }

    // 削除
    if (action === 'remove') {
      removeUser(targetId);
      saveDB();
      delete pendingAction[userId];
      return reply(event.replyToken, '❌削除完了');
    }

    // BAN解除
    if (action === 'unban') {
      delete db.bannedUsers[targetId];
      db.violationCount[targetId] = 0;
      saveDB();
      delete pendingAction[userId];
      return reply(event.replyToken, '✅BAN解除');
    }
  }

  return null;
}

// ===== 違反 =====
function violation(event, userId) {
  db.violationCount[userId] = (db.violationCount[userId] || 0) + 1;

  if (db.violationCount[userId] >= 3) {
    db.bannedUsers[userId] = true;
    saveDB();
    return reply(event.replyToken, '🚫制限されました');
  }

  saveDB();
  return reply(event.replyToken, '⚠️警告');
}

// ===== 管理者一覧（名前表示）=====
async function showAdminList(token) {

  async function getName(id) {
    try {
      const profile = await client.getProfile(id);
      return profile.displayName;
    } catch {
      return id;
    }
  }

  let text = "👑本管理\n";
  for (let id of db.MAIN_ADMIN) {
    text += await getName(id) + "\n";
  }

  text += "\n🔧副管理\n";
  for (let id of db.SUB_ADMIN) {
    text += await getName(id) + "\n";
  }

  text += "\n🛠サポート\n";
  for (let id of db.SUPPORT) {
    text += await getName(id) + "\n";
  }

  return reply(token, text);
}

// ===== 画像風メニュー =====
function showMenu(token) {
  return client.replyMessage(token, {
    type: "flex",
    altText: "管理メニュー",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [

          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              panel("👑","管理追加","#4A90E2"),
              panel("⚠️","通報","#FF4D4F"),
              panel("📋","管理一覧","#36CFC9")
            ]
          },

          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              panel("❌","管理削除","#722ED1"),
              panel("🔓","BAN解除","#FA8C16"),
              panel("📜","ルール","#2F54EB")
            ]
          }

        ]
      }
    }
  });
}

// ===== パネルUI =====
function panel(icon, text, color){
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: color,
    cornerRadius: "md",
    paddingAll: "10px",
    alignItems: "center",
    justifyContent: "center",
    height: "80px",
    contents: [
      { type: "text", text: icon, size: "lg" },
      { type: "text", text: text, size: "xs", color: "#FFFFFF", margin: "sm" }
    ],
    action: {
      type: "message",
      label: text,
      text: text === "管理一覧" ? "管理者一覧" : text
    }
  };
}

// ===== 役職メニュー =====
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
  return {
    type:"button",
    action:{type:"message",label:text,text:text}
  };
}

// ===== 共通 =====
function reply(token, text){
  return client.replyMessage(token,{type:'text',text});
}

function isAdmin(id){
  return db.MAIN_ADMIN.includes(id) || db.SUB_ADMIN.includes(id);
}

function removeUser(id){
  ['MAIN_ADMIN','SUB_ADMIN','SUPPORT'].forEach(k=>{
    db[k] = db[k].filter(x => x !== id);
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT);
