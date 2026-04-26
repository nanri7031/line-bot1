// ===== 必要パッケージ =====
// npm install express @line/bot-sdk

const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

// ===== LINE設定 =====
const config = {
  channelAccessToken: "ここにあなたの長期アクセストークン",
  channelSecret: "ここにチャネルシークレット"
};

const client = new line.Client(config);

// ===== ミドルウェア =====
app.use("/webhook", line.middleware(config));

// ===== メイン処理 =====
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];

    await Promise.all(events.map(async (event) => {

      // テキストメッセージ
      if (event.type === "message" && event.message.type === "text") {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "受信：" + event.message.text
        });
      }

      // スタンプ・画像など全部に最低限反応させる
      if (event.type === "message") {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "メッセージ受信"
        });
      }

      // 参加時（グループなど）
      if (event.type === "join") {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "参加しました"
        });
      }

      // フォロー時
      if (event.type === "follow") {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "友達追加ありがとう"
        });
      }

    }));

    res.status(200).end();

  } catch (err) {
    console.error("エラー:", err);
    res.status(500).end();
  }
});

// ===== サーバー起動 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("起動ポート:", PORT);
});
