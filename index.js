const line = require('@line/bot-sdk');
const express = require('express');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);
const app = express();

// ===== 管理者 =====
const MAIN_ADMIN = ['U1a1aca9e44466f8cb05003d7dc86fee0'];
const SUB_ADMIN = [];
const SUPPORT = [];

// ===== 状態 =====
let pendingAction = {};
let pendingRole = {};
let emergencyMode = false;

// ===== NG =====
const NG_WORDS = ['死ね','バカ','消えろ','アホ'];

// ===== データ =====
let stampLog = {};
let violationCount = {};
let bannedUsers = {};

// ===== 設定 =====
const WARN_LIMIT = 2;
const BAN_LIMIT = 3;

// ===== webhook =====
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.json({ success: true }))
    .catch(err => console.error(err));
});

// ===== メイン処理 =====
async function handleEvent(event) {

  const userId = event.source.userId;

  // BAN中
  if (bannedUsers[userId]) {
    return reply(event.replyToken, '🚫発言制限中');
  }

  // 参加時
  if (event.type === 'memberJoined') {
    return showMenu(event.replyToken);
  }

  if (event.type !== 'message') return null;

  // スタンプ
  if (event.message.type === 'sticker') {
    const now = Date.now();
    stampLog[userId] = (stampLog[userId] || []).filter(t => now - t < 5000);
    stampLog[userId].push(now);

    if (stampLog[userId].length >= 3) {
      return violation(event, userId, 'スタンプ連投');
    }
  }

  if (event.message.type !== 'text') return null;

  const text = event.message.text;

  // NG
  if (NG_WORDS.some(w => text.includes(w))) {
    return violation(event, userId, 'NGワード');
  }

  // ===== コマンド =====
  if (text === 'メニュー') return showMenu(event.replyToken);

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
    return reply(event.replyToken, '削除したいユーザーに返信してください');
  }

  // BAN解除
  if (text === 'BAN解除') {
    if (!isAdmin(userId)) return;
    pendingAction[userId] = 'unban';
    return reply(event.replyToken, '解除したいユーザーに返信してください');
  }

  // 役職選択
  if (['本管理','副管理','サポート'].includes(text)) {
    if (pendingAction[userId] !== 'add') return;
    pendingRole[userId] = text;
    return reply(event.replyToken, '対象ユーザーに返信してください');
  }

  // 返信処理
  if (event.message.quoteToken) {

    const action = pendingAction[userId];
    const role = pendingRole[userId];
    const targetId = userId; // 簡易

    // 追加
    if (action === 'add' && role) {
      if (role === '本管理') MAIN_ADMIN.push(targetId);
      if (role === '副管理') SUB_ADMIN.push(targetId);
      if (role === 'サポート') SUPPORT.push(targetId);

      delete pendingAction[userId];
      delete pendingRole[userId];

      return reply(event.replyToken, `✅${role}追加`);
    }

    // 削除
    if (action === 'remove') {
      removeUser(targetId);
      delete pendingAction[userId];
      return reply(event.replyToken, '❌管理者削除');
    }

    // BAN解除
    if (action === 'unban') {
      delete bannedUsers[targetId];
      violationCount[targetId] = 0;
      delete pendingAction[userId];
      return reply(event.replyToken, '✅BAN解除');
    }
  }

  // 緊急
  if (text === '緊急ON') {
    if (!isAdmin(userId)) return;
    emergencyMode = true;
    return reply(event.replyToken, '🚨緊急ON');
  }

  if (text === '緊急OFF') {
    if (!isAdmin(userId)) return;
    emergencyMode = false;
    return reply(event.replyToken, '緊急OFF');
  }

  // 通報
  if (text === '通報') {
    notifyAdmins(`🚨通報\nID:${userId}`);
    return reply(event.replyToken, '通報しました');
  }

  return null;
}

// ===== 違反処理 =====
function violation(event, userId, reason) {
  violationCount[userId] = (violationCount[userId] || 0) + 1;
  const count = violationCount[userId];

  if (count <= WARN_LIMIT) {
    return reply(event.replyToken, `⚠️${reason}（${count}/${BAN_LIMIT}）`);
  }

  if (count >= BAN_LIMIT) {
    bannedUsers[userId] = true;
    notifyAdmins(`🚨BAN\n理由:${reason}\nID:${userId}`);
    return reply(event.replyToken, '🚫制限されました');
  }
}

// ===== 管理者一覧 =====
function showAdminList(token) {

  const main = MAIN_ADMIN.length ? MAIN_ADMIN.join('\n') : 'なし';
  const sub = SUB_ADMIN.length ? SUB_ADMIN.join('\n') : 'なし';
  const sup = SUPPORT.length ? SUPPORT.join('\n') : 'なし';

  const msg =
`👑本管理
${main}

🔧副管理
${sub}

🛠サポート
${sup}`;

  return client.replyMessage(token, {
    type: 'text',
    text: msg
  });
}

// ===== UI =====
function showMenu(token) {
  return client.replyMessage(token, {
    type: "flex",
    altText: "メニュー",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          row("管理追加","通報","管理者一覧"),
          row("管理削除","BAN解除","ルール"),
          row("緊急ON","緊急OFF","メニュー")
        ]
      }
    }
  });
}

function row(a,b,c){
  return {
    type:"box",
    layout:"horizontal",
    contents:[
      btn(a),btn(b),btn(c)
    ]
  };
}

function btn(text){
  return {
    type:"button",
    style:"primary",
    action:{type:"message",label:text,text:text}
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

// ===== 共通 =====
function reply(token, text){
  return client.replyMessage(token,{type:'text',text});
}

function isAdmin(id){
  return MAIN_ADMIN.includes(id)||SUB_ADMIN.includes(id);
}

function notifyAdmins(msg){
  MAIN_ADMIN.forEach(id=>{
    client.pushMessage(id,{type:'text',text:msg});
  });
}

function removeUser(id){
  [MAIN_ADMIN,SUB_ADMIN,SUPPORT].forEach(arr=>{
    const i=arr.indexOf(id);
    if(i>-1) arr.splice(i,1);
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT);
