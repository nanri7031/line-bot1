import express from "express"
import line from "@line/bot-sdk"
import { Low } from "lowdb"
import { JSONFile } from "lowdb/node"

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)

// DB設定（←ここ重要）
const adapter = new JSONFile("db.json")
const db = new Low(adapter, {
  admins: [],
  subAdmins: [],
  banList: [],
  reports: {},
  settings: {
    autoBan: 3,
    ngWords: []
  }
})

// 初期化
await db.read()
db.data ||= {
  admins: [],
  subAdmins: [],
  banList: [],
  reports: {},
  settings: {
    autoBan: 3,
    ngWords: []
  }
}
await db.write()

app.post("/webhook", line.middleware(config), async (req, res) => {
  const events = req.body.events

  await Promise.all(events.map(handleEvent))
  res.sendStatus(200)
})

async function handleEvent(event) {
  if (event.type !== "message") return

  if (event.message.type === "text") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "BOT起動中"
    })
  }
}

app.listen(3000, () => console.log("Server running"))
