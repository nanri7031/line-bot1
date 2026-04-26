import express from "express"
import line from "@line/bot-sdk"

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    for (const event of req.body.events) {

      if (event.type === "message") {
        const msg = event.message.text

        // 🔥 メニュー
        if (msg === "メニュー") {
          await client.replyMessage(event.replyToken, {
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
                    type: "text",
                    text: "管理メニュー",
                    weight: "bold",
                    size: "lg"
                  },
                  {
                    type: "button",
                    style: "primary",
                    color: "#4A90E2",
                    action: { type: "message", label: "管理登録", text: "管理登録" }
                  },
                  {
                    type: "button",
                    style: "primary",
                    color: "#4A90E2",
                    action: { type: "message", label: "BAN一覧", text: "BAN一覧" }
                  },
                  {
                    type: "button",
                    style: "primary",
                    color: "#4A90E2",
                    action: { type: "message", label: "BAN解除", text: "BAN解除" }
                  }
                ]
              }
            }
          })

        } else {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "OK"
          })
        }
      }
    }
    res.sendStatus(200)
  } catch (e) {
    console.log(e)
    res.sendStatus(500)
  }
})

app.listen(process.env.PORT || 3000)
