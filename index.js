require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');

const app = express();
app.use(express.json());

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

// ===== DB =====
const DB_FILE = './db.json';

let db = {
  admins: ["U1a1aca9e44466f8cb05003d7dc86fee0"],
  blacklist: [],
  reports: {},
  users: {},
  logs: []
};

if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ===== NG =====
const NG_WORDS = ["死ね", "荒らし", "spam", "詐欺"];

// ===== Webhook =====
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end());
});

// ===== BOT =====
async function handleEvent(event) {

  if (event.type === 'memberJoined') {
    const groupId = event.source.groupId;
    for (let m of event.joined.members) {
      if (db.blacklist.includes(m.userId)) {
        await kick(groupId, m.userId);
      }
    }
    return;
  }

  if (event.type !== 'message' || event.message.type !== 'text') return;

  const text = event.message.text;
  const groupId = event.source.groupId;
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const mentions = event.message.mention?.mentionees || [];

  // ユーザー記録
  db.users[userId] = true;

  // ===== ブラック =====
  if (db.blacklist.includes(userId)) {
    await kick(groupId, userId);
    return;
  }

  // ===== NG =====
  if (NG_WORDS.some(w => text.includes(w))) {
    ban(userId, "NG");
    await kick(groupId, userId);
    return;
  }

  // ===== 通報 =====
  if (text.startsWith('通報')) {
    const target = mentions[0]?.userId;
    if (!target) return reply(replyToken, '対象を@指定');

    if (!db.reports[groupId]) db.reports[groupId] = {};
    if (!db.reports[groupId][target]) db.reports[groupId][target] = [];

    if (db.reports[groupId][target].includes(userId)) {
      return reply(replyToken, '通報済み');
    }

    db.reports[groupId][target].push(userId);
    saveDB();

    const count = db.reports[groupId][target].length;

    if (count >= 3) {
      ban(target, "通報");
      await kick(groupId, target);
      return reply(replyToken, 'BAN実行');
    }

    return reply(replyToken, `通報 ${count}/3`);
  }

  // ===== 管理UI =====
  if (text === '管理パネル') {
    return client.replyMessage(replyToken, createUserListFlex());
  }

  // ===== BANボタン処理 =====
  if (text.startsWith('BAN:')) {
    if (!db.admins.includes(userId)) return;

    const target = text.replace('BAN:', '');
    ban(target, "ボタンBAN");
    await kick(groupId, target);
    return reply(replyToken, 'BAN完了');
  }
}

// ===== UI生成 =====
function createUserListFlex() {
  const users = Object.keys(db.users).slice(-5);

  return {
    type: "flex",
    altText: "ユーザー管理",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: users.map(id => ({
          type: "button",
          action: {
            type: "message",
            label: id.substring(0, 6),
            text: "BAN:" + id
          }
        }))
      }
    }
  };
}

// ===== BAN =====
function ban(userId, reason) {
  if (!db.blacklist.includes(userId)) {
    db.blacklist.push(userId);
    log(`BAN ${userId} (${reason})`);
    saveDB();
  }
}

// ===== ログ =====
function log(msg) {
  db.logs.push(msg);
  if (db.logs.length > 100) db.logs.shift();
}

// ===== 管理画面 =====
app.get('/admin', (req, res) => {
  if (req.query.key !== process.env.ADMIN_KEY) return res.send("NG");

  res.send(`
    <h2>管理</h2>
    <h3>ユーザー</h3>${Object.keys(db.users).join("<br>")}
    <h3>ブラック</h3>${db.blacklist.join("<br>")}
    <h3>ログ</h3>${db.logs.join("<br>")}
  `);
});

// ===== 共通 =====
async function kick(groupId, userId) {
  try {
    await client.removeMemberFromGroup(groupId, userId);
  } catch {}
}

function reply(token, text) {
  return client.replyMessage(token, { type: 'text', text });
}

app.listen(3000);
