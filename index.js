import express from "express"
import line from "@line/bot-sdk"
import dotenv from "dotenv"
import { Low } from "lowdb"
import { JSONFile } from "lowdb/node"

dotenv.config()

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)

// ✅ DB（完全修正）
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

await db.read()
await db.write()

// Webhook
app.post("/webhook", line.middleware(config), async (req, res) => {
  const events = req.body.events
  await Promise.all(events.map(handleEvent))
  res.sendStatus(200)
})

// 動作確認用（←これがポート解決）
app.get("/", (req, res) => {
  res.send("BOT is running")
})

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return

  const text = event.message.text
  const userId = event.source.userId
  const groupId = event.source.groupId

  if (text === "管理者登録") {
    if (!db.data.admins.includes(userId)) {
      db.data.admins.push(userId)
      await db.write()
      return reply(event, "管理者登録完了")
    }
    return reply(event, "既に管理者です")
  }

  if (text === "メニュー") {
    return reply(event,
`【管理メニュー】
・通報 @ユーザー
・BAN @ユーザー
・NG追加 ワード
・設定`)
  }

  if (text.startsWith("通報")) {
    const mention = event.message.mention
    if (!mention) return reply(event, "メンションしてね")

    const target = mention.mentionees[0].userId

    db.data.reports[target] = (db.data.reports[target] || 0) + 1

    if (db.data.reports[target] >= db.data.settings.autoBan) {
      await client.kickoutFromGroup(groupId, [target])
      db.data.banList.push(target)
      await db.write()
      return reply(event, "自動BANしました")
    }

    await db.write()
    return reply(event, `通報数: ${db.data.reports[target]}`)
  }

  if (text.startsWith("BAN")) {
    const mention = event.message.mention
    if (!mention) return reply(event, "メンションしてね")

    const target = mention.mentionees[0].userId
    await client.kickoutFromGroup(groupId, [target])
    return reply(event, "BAN完了")
  }

  if (text.startsWith("NG追加")) {
    const word = text.replace("NG追加 ", "")
    db.data.settings.ngWords.push(word)
    await db.write()
    return reply(event, `追加: ${word}`)
  }

  for (const word of db.data.settings.ngWords) {
    if (text.includes(word)) {
      await client.kickoutFromGroup(groupId, [userId])
      return
    }
  }

  if (text === "設定") {
    return reply(event,
`【設定】
自動BAN回数: ${db.data.settings.autoBan}
NGワード: ${db.data.settings.ngWords.join(", ")}`)
  }

  return reply(event, "コマンド不明")
}

function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: "text",
    text
  })
}

// ❗ポート修正（これ重要）
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on " + PORT))
