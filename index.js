// ===== 必要パッケージ =====
// npm install express @line/bot-sdk

const express = requireの("express");
const line = require("@line/bot-sdk");

const app = express();

// ===== LINE設定 =====
const config = {
  channelAccessToken: "ZuBpejw3lChWMM1n59PJq7dQ6fQCWRqexOVRx74UcjA3twD1yt+dvfXDRxUBhbI0l3xX7BQ7c+xSirNmRAWnmk/w1R7IMhlKToJnQtiORz2opDAuPx3ndckC3saC509mbva/C7FkLQy99Ozp/vz8igdB04t89/1O/w1cDnyilFU=",
  channelSecret: "27b76eec6bcfefb6183dd2a79fb42896"
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
