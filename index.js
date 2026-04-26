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
const db = new Low(new JSONFile("db.json"))
await db.read()

db.data ||= {
  admins: ["U1a1aca9e44466f8cb05003d7dc86fee0"],
  subAdmins: [],
  banList: [],
  reports: {},
  userCounts: {},
  emergency: false,
  logs: [],
  settings: {
    autoBan: 3,
    ngWords: ["死ね", "荒らし"]
  }
}

await db.write()

// Webhook
app.post("/webhook", line.middleware(config), async (req, res) => {
  await Promise.all(req.body.events.map(handleEvent))
  res.sendStatus(200)
})

// =======================
// 🖥 Web管理画面
// =======================
app.get("/", async (req, res) => {
  await db.read()

  res.send(`
    <h1>BOT管理画面</h1>
    <p>緊急モード: ${db.data.emergency}</p>

    <h2>NGワード</h2>
    <pre>${db.data.settings.ngWords.join(", ")}</pre>

    <h2>通報</h2>
    <pre>${JSON.stringify(db.data.reports, null, 2)}</pre>

    <h2>BANリスト</h2>
    <pre>${db.data.banList.join("\n")}</pre>
  `)
})

// =======================
// メイン処理
// =======================
async function handleEvent(event) {

  await db.read()

  // 👣 参加ログ
  if (event.type === "memberJoined") {
    db.data.logs.push(`参加: ${JSON.stringify(event.source)}`)
    await db.write()

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "👣 新しいメンバーが参加しました"
    })
  }

  // 👣 退出ログ
  if (event.type === "memberLeft") {
    db.data.logs.push(`退出: ${JSON.stringify(event.source)}`)
    await db.write()
    return
  }

  if (event.type !== "message") return
  if (event.message.type !== "text") return

  const text = event.message.text
  const userId = event.source.userId

  const {
    admins,
    subAdmins,
    banList,
    userCounts,
    emergency,
    settings
  } = db.data

  const { ngWords, autoBan } = settings

  const isAdmin = admins.includes(userId)
  const isSubAdmin = subAdmins.includes(userId)

  // 🚫 BAN済み
  if (banList.includes(userId)) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "🚫 BANされています"
    })
  }

  // 🚨 緊急モード
  if (emergency && !isAdmin) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "🚨 緊急モード中"
    })
  }

  // 🔥 NG検知
  const isNG = ngWords.some(w => text.includes(w))

  if (isNG && !isAdmin && !isSubAdmin) {
    userCounts[userId] = (userCounts[userId] || 0) + 1

    if (userCounts[userId] >= autoBan) {
      banList.push(userId)
      await db.write()

      // 📩 管理者通知
      admins.forEach(id => {
        client.pushMessage(id, {
          type: "text",
          text: `🚨 自動BAN\nユーザー: ${userId}`
        })
      })

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "🚫 BANしました"
      })
    }

    await db.write()

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `⚠️ NG (${userCounts[userId]}/${autoBan})`
    })
  }

  // =======================
  // コマンド
  // =======================

  if (text === "メニュー") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        "【管理】\n通報 / BAN / 緊急オン / 緊急オフ / 設定"
    })
  }

  if (text === "設定") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        `NG: ${settings.ngWords.join(",")}\nBAN回数:${settings.autoBan}`
    })
  }

  if (text.startsWith("NG追加") && isAdmin) {
    const word = text.replace("NG追加", "").trim()
    settings.ngWords.push(word)
    await db.write()

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `追加: ${word}`
    })
  }

  if (text.startsWith("NG削除") && isAdmin) {
    const word = text.replace("NG削除", "").trim()
    settings.ngWords = settings.ngWords.filter(w => w !== word)
    await db.write()

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `削除: ${word}`
    })
  }

  if (text === "緊急オン" && isAdmin) {
    db.data.emergency = true
    await db.write()

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "🚨 ON"
    })
  }

  if (text === "緊急オフ" && isAdmin) {
    db.data.emergency = false
    await db.write()

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "✅ OFF"
    })
  }

  if (text === "通報") {
    db.data.reports[userId] = (db.data.reports[userId] || 0) + 1
    await db.write()

    // 📩 管理者通知
    admins.forEach(id => {
      client.pushMessage(id, {
        type: "text",
        text: `📩 通報\nユーザー: ${userId}`
      })
    })

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "通報しました"
    })
  }

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "コマンド不明"
  })
}

app.listen(process.env.PORT || 3000)
