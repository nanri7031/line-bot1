require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');

const app = express();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

// ===== 管理データ =====
let admins = ["U1a1aca9e44466f8cb05003d7dc86fee0"]; // あなた
let banList = [];
let emergency = false;

const NG_WORDS = ["死ね", "荒らし", "NGワード"];

// ===== Webhook =====
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(result => res.json(result))
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

// ===== メイン処理 =====
async function handleEvent(event) {

  const groupId = event.source.groupId;

  // ===== 新規参加者 挨拶 =====
  if (event.type === 'memberJoined') {
    return client.pushMessage(groupId, {
      type: "text",
      text:
`当グルにご参加頂きありがとうございます😊
まずは、ノートのルールを確認して下さいね♪
確認後イイね必ずタップして下さい♪`
    });
  }

  // ===== メッセージ以外無視 =====
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const text = event.message.text;

  // ===== ログ =====
  console.log("USER:", userId);
  console.log("TEXT:", text);
  console.log("IS_ADMIN:", admins.includes(userId));

  // ===== 管理パネル表示しない =====
  if (text === "管理パネル") return;

  // ===== BAN済みチェック =====
  if (banList.includes(userId)) {
    await client.replyMessage(event.replyToken, {
      type: "text",
      text: "🚫 BANされています"
    });
    await client.leaveGroup(groupId);
    return;
  }

  // ===== NGワード =====
  if (NG_WORDS.some(w => text.includes(w))) {
    banList.push(userId);

    await client.replyMessage(event.replyToken, {
      type: "text",
      text: "⚠️ NGワード検出 → BAN"
    });

    await client.leaveGroup(groupId);
    return;
  }

  // ===== 通報（誰でもOK） =====
  if (text === "通報") {

    const msg = `🚨通報発生\nユーザーID:${userId}`;

    for (let adminId of admins) {
      await client.pushMessage(adminId, {
        type: "text",
        text: msg
      });
    }

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "✅ 通報送信"
    });
  }

  // ===== ルール =====
  if (text === "ルール") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "📋ルール\n・荒らし禁止\n・迷惑行為禁止\n・違反はBAN対象"
    });
  }

  // ===== 設定 =====
  if (text === "設定") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "⚙️設定機能は準備中"
    });
  }

  // ===== 管理者チェック =====
  if (!admins.includes(userId)) return;

  // ===== 管理追加（ID指定） =====
  if (text.startsWith("管理追加")) {

    const parts = text.split(" ");
    const targetId = parts[1];

    if (!targetId) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "例：管理追加 Uxxxxxxxx"
      });
    }

    if (!admins.includes(targetId)) {
      admins.push(targetId);
    }

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "✅ 管理者追加完了"
    });
  }

  // ===== BAN（ID指定） =====
  if (text.startsWith("BAN")) {

    const parts = text.split(" ");
    const targetId = parts[1];

    if (!targetId) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "例：BAN Uxxxxxxxx"
      });
    }

    banList.push(targetId);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "🚫 BAN完了"
    });
  }

  // ===== BAN解除 =====
  if (text === "BAN解除") {
    banList = [];
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "✅ BAN解除"
    });
  }

  // ===== 緊急ON =====
  if (text === "緊急ON") {
    emergency = true;
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "🚨 緊急ON"
    });
  }

  // ===== 緊急OFF =====
  if (text === "緊急OFF") {
    emergency = false;
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "🟢 緊急OFF"
    });
  }

  // ===== キック（BOT退室） =====
  if (text === "キック") {
    await client.replyMessage(event.replyToken, {
      type: "text",
      text: "👢 BOT退室"
    });
    await client.leaveGroup(groupId);
    return;
  }

  return Promise.resolve(null);
}

// ===== 起動 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("BOT起動中"));
