require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

// ===== DB =====
const db = new Low(new JSONFile('db.json'));

async function initDB() {
  await db.read();
  db.data ||= {
    admins: ["U1a1aca9e44466f8cb05003d7dc86fee0"],
    subAdmins: [],
    banList: [],
    reports: {},
    settings: {
      autoBan: 3,
      ngWords: ["死ね", "荒らし"]
    }
  };
  await db.write();
}

// ===== 権限 =====
const isAdmin = id => db.data.admins.includes(id);
const isSub = id => db.data.subAdmins.includes(id);
const isStaff = id => isAdmin(id) || isSub(id);

// ===== Flex UI =====
const btn = (label) => ({
  type: "button",
  style: "primary",
  action: { type: "message", label, text: label }
});

const flex = (title, buttons) => ({
  type: "flex",
  altText: title,
  contents: {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: title, weight: "bold", size: "lg" },
        ...buttons.map(b => btn(b))
      ]
    }
  }
});

// ===== Webhook =====
app.post('/webhook', line.middleware(config), async (req, res) => {
  await initDB();

  await Promise.all(req.body.events.map(handleEvent));

  await db.write();
  res.json({});
});

// ===== メイン処理 =====
async function handleEvent(event) {

  if (event.type !== 'message') return;

  const userId = event.source.userId;
  const groupId = event.source.groupId;
  const text = event.message.text || "";

  console.log("USER:", userId, "TEXT:", text);

  // ===== BANチェック =====
  if (db.data.banList.includes(userId)) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "🚫 あなたは利用できません"
    });
  }

  // ===== NGワード =====
  if (db.data.settings.ngWords.some(w => text.includes(w))) {
    db.data.banList.push(userId);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "🚫 NGワード検出 → BAN"
    });
  }

  // ===== メニュー =====
  if (text === "メニュー") {
    return client.replyMessage(event.replyToken,
      flex("📋 メニュー",
        isStaff(userId)
          ? ["通報", "ルール", "設定"]
          : ["通報", "ルール"]
      )
    );
  }

  // ===== 設定 =====
  if (text === "設定" && isStaff(userId)) {
    return client.replyMessage(event.replyToken,
      flex("⚙ 管理設定", [
        "BAN指定",
        "キック指定",
        "管理追加",
        "BAN解除",
        "通報リセット",
        "設定+",
        "設定-"
      ])
    );
  }

  // ===== 通報 =====
  if (text === "通報") {
    db.data.reports[userId] = (db.data.reports[userId] || 0) + 1;

    if (db.data.reports[userId] >= db.data.settings.autoBan) {
      db.data.banList.push(userId);

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "🚫 通報多数 → BAN"
      });
    }

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `通報回数: ${db.data.reports[userId]}`
    });
  }

  // ===== 設定変更 =====
  if (text === "設定+" && isAdmin(userId)) {
    db.data.settings.autoBan++;
  }

  if (text === "設定-" && isAdmin(userId)) {
    db.data.settings.autoBan--;
  }

  // ===== メンションBAN =====
  if (event.message.mentions && isStaff(userId)) {
    const target = event.message.mentions.mentionees[0].userId;

    db.data.banList.push(target);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "🚫 BAN完了"
    });
  }

  // ===== 管理追加 =====
  if (text.startsWith("管理追加") && isAdmin(userId)) {
    const id = text.split(" ")[1];
    if (id) db.data.subAdmins.push(id);
  }

  // ===== BAN解除 =====
  if (text === "BAN解除") {
    db.data.banList = [];
    return client.replyMessage(event.replyToken, { type: "text", text: "解除完了" });
  }

  // ===== 通報リセット =====
  if (text === "通報リセット") {
    db.data.reports = {};
    return client.replyMessage(event.replyToken, { type: "text", text: "リセット完了" });
  }

  // ===== ルール =====
  if (text === "ルール") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "荒らし禁止・迷惑行為禁止"
    });
  }
}

// ===== 起動 =====
app.listen(process.env.PORT || 3000, () => console.log("プロBOT起動"));
