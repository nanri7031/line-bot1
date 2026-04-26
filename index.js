import express from "express";
import line from "@line/bot-sdk";

const app = express();

// ===== LINE設定（←ここ戻す）=====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

// ===== ミドルウェア =====
app.use("/webhook", line.middleware(config));

// ===== メイン処理 =====
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];

    await Promise.all(events.map(async (event) => {

      if (event.type === "message" && event.message.type === "text") {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "受信：" + event.message.text
        });
      }

      if (event.type === "message") {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "メッセージ受信"
        });
      }

      if (event.type === "join") {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "参加しました"
        });
      }

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
