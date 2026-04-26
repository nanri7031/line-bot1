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
await db.read();
db.data ||= {
  superAdmins: ["U1a1aca9e44466f8cb05003d7dc86fee0"],
  subAdmins: [],
  banList: [],
  reports: {},
  settings: { autoBan: 3 }
};

// ===== 権限 =====
const isAdmin = id => db.data.superAdmins.includes(id);
const isSub = id => db.data.subAdmins.includes(id);
const isStaff = id => isAdmin(id) || isSub(id);

// ===== Flex =====
const flex = (btns) => ({
  type: "flex",
  altText: "メニュー",
  contents: {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: btns.map(b => ({
        type: "button",
        style: "primary",
        action: { type: "message", label: b.label, text: b.text }
      }))
    }
  }
});

// ===== メニュー =====
const menu = (uid) => {
  let btns = [
    { label: "通報", text: "通報" },
    { label: "ルール", text: "ルール" }
  ];

  if (isStaff(uid)) {
    btns.unshift(
      { label: "管理パネル", text: "管理パネル" }
    );
  }

  return flex(btns);
};

// ===== 管理パネル =====
const adminPanel = (uid) => {
  let btns = [
    { label: "BAN（メンション）", text: "BAN" },
    { label: "副管理者追加", text: "副管理者追加" },
    { label: "設定", text: "設定" }
  ];

  if (isAdmin(uid)) {
    btns.unshift({ label: "管理者追加", text: "管理追加" });
  }

  return flex(btns);
};

// ===== 設定 =====
const settingsUI = () => flex([
  { label: `通報BAN:${db.data.settings.autoBan}`, text: "noop" },
  { label: "+1", text: "設定+" },
  { label: "-1", text: "設定-" }
]);

// ===== Webhook =====
app.post('/webhook', line.middleware(config), async (req, res) => {
  await db.read();

  await Promise.all(req.body.events.map(handleEvent));

  await db.write();
  res.json({});
});

// ===== メイン =====
async function handleEvent(event) {

  const groupId = event.source.groupId;
  const userId = event.source.userId;

  // ===== 参加 =====
  if (event.type === 'memberJoined') {
    return client.pushMessage(groupId, {
      type: "text",
      text:
`当グルにご参加頂きありがとうございます😊
まずはノートのルール確認お願いします♪`
    });
  }

  if (event.type !== 'message') return;

  const text = event.message.text || "";

  console.log(userId, text);

  // ===== BANチェック =====
  if (db.data.banList.includes(userId)) {
    await client.leaveGroup(groupId);
    return;
  }

  // ===== メニュー =====
  if (text === "メニュー") {
    return client.replyMessage(event.replyToken, menu(userId));
  }

  // ===== 管理パネル =====
  if (text === "管理パネル" && isStaff(userId)) {
    return client.replyMessage(event.replyToken, adminPanel(userId));
  }

  // ===== 設定 =====
  if (text === "設定" && isStaff(userId)) {
    return client.replyMessage(event.replyToken, settingsUI());
  }

  if (text === "設定+" && isAdmin(userId)) {
    db.data.settings.autoBan++;
  }

  if (text === "設定-" && isAdmin(userId)) {
    db.data.settings.autoBan--;
  }

  // ===== 通報 =====
  if (text === "通報") {

    db.data.reports[userId] = (db.data.reports[userId] || 0) + 1;

    if (db.data.reports[userId] >= db.data.settings.autoBan) {
      db.data.banList.push(userId);

      await client.replyMessage(event.replyToken, {
        type: "text",
        text: "🚫 通報多数でBAN"
      });

      await client.leaveGroup(groupId);
      return;
    }

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `通報 ${db.data.reports[userId]}回`
    });
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
    if (id) db.data.superAdmins.push(id);
  }

  // ===== 副管理者 =====
  if (text.startsWith("副管理者追加") && isAdmin(userId)) {
    const id = text.split(" ")[1];
    if (id) db.data.subAdmins.push(id);
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
app.listen(process.env.PORT || 3000, () => console.log("最終BOT起動"));
