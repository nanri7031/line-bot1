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

// DB
const adapter = new JSONFile("db.json")
const db = new Low(adapter)

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

// Webhook
app.post("/webhook", line.middleware(config), async (req, res) => {
  const events = req.body.events
  await Promise.all(events.map(handleEvent))
  res.sendStatus(200)
})

// メイン処理
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return

  const text = event.message.text
  const userId = event.source.userId
  const groupId = event.source.groupId

  // 管理者登録
  if (text === "管理者登録") {
    if (!db.data.admins.includes(userId)) {
      db.data.admins.push(userId)
      await db.write()
      return reply(event, "管理者登録完了")
    }
  }

  // メニュー
  if (text === "メニュー") {
    return reply(event,
`【管理メニュー】
・通報 @ユーザー
・BAN @ユーザー
・NG追加 ワード
・設定`)
  }

  // 通報
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

  // BAN
  if (text.startsWith("BAN")) {
    const mention = event.message.mention
    if (!mention) return reply(event, "メンションしてね")

    const target = mention.mentionees[0].userId
    await client.kickoutFromGroup(groupId, [target])
    return reply(event, "BAN完了")
  }

  // NGワード追加
  if (text.startsWith("NG追加")) {
    const word = text.replace("NG追加 ", "")
    db.data.settings.ngWords.push(word)
    await db.write()
    return reply(event, `追加: ${word}`)
  }

  // NGワード検知
  for (const word of db.data.settings.ngWords) {
    if (text.includes(word)) {
      await client.kickoutFromGroup(groupId, [userId])
      return
    }
  }

  // 設定
  if (text === "設定") {
    return reply(event,
`【設定】
自動BAN回数: ${db.data.settings.autoBan}
NGワード: ${db.data.settings.ngWords.join(", ")}`)
  }

  return reply(event, "コマンド不明")
}

// 返信
function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: "text",
    text
  })
}

app.listen(3000, () => console.log("Server running"))
