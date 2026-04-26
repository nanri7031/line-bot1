import express from "express"
import line from "@line/bot-sdk"
import dotenv from "dotenv"
import { Low } from "lowdb"
import { JSONFile } from "lowdb/node"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)

// ===== DB設定（絶対安定版）=====
const adapter = new JSONFile(join(__dirname, "db.json"))
const db = new Low(adapter, {
  admins: ["U1a1aca9e44466f8cb05003d7dc86fee0"],
  subAdmins: [],
  banList: [],
  reports: {},
  userCounts: {},
  emergency: false,
  settings: {
    autoBan: 3,
    ngWords: ["死ね", "荒らし"]
  }
})

await db.read()
await db.write()

// ===== 状態管理 =====
const userState = {}

app.post("/webhook", line.middleware(config), async (req, res) => {
  await Promise.all(req.body.events.map(handleEvent))
  res.sendStatus(200)
})

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return

  const text = event.message.text
  const userId = event.source.userId

  const isAdmin = db.data.admins.includes(userId)
  const isSub = db.data.subAdmins.includes(userId)

  // BAN済み
  if (db.data.banList.includes(userId)) {
    return reply(event, "あなたはBANされています")
  }

  // 緊急モード
  if (db.data.emergency && !isAdmin) {
    return reply(event, "現在緊急モード中")
  }

  // NGワード処理
  for (let word of db.data.settings.ngWords) {
    if (text.includes(word) && !isAdmin && !isSub) {
      db.data.userCounts[userId] = (db.data.userCounts[userId] || 0) + 1

      if (db.data.userCounts[userId] >= db.data.settings.autoBan) {
        db.data.banList.push(userId)
        await db.write()
        return reply(event, "自動BANしました")
      }

      await db.write()
      return reply(event, `警告 (${db.data.userCounts[userId]})`)
    }
  }

  // ===== コマンド =====

  if (text === "メニュー") return sendMenu(event)

  if (text === "設定" && (isAdmin || isSub)) {
    return reply(event, `【設定】
BAN回数:${db.data.settings.autoBan}
NG:${db.data.settings.ngWords.join(",")}`)
  }

  if (text.startsWith("NG追加") && (isAdmin || isSub)) {
    const words = text.replace("NG追加", "").trim().split(",")
    db.data.settings.ngWords.push(...words)
    await db.write()
    return reply(event, "追加完了")
  }

  if (text.startsWith("NG削除") && (isAdmin || isSub)) {
    const word = text.replace("NG削除", "").trim()
    db.data.settings.ngWords =
      db.data.settings.ngWords.filter(w => w !== word)
    await db.write()
    return reply(event, "削除完了")
  }

  if (text === "緊急オン" && isAdmin) {
    db.data.emergency = true
    await db.write()
    return reply(event, "緊急ON")
  }

  if (text === "緊急オフ" && isAdmin) {
    db.data.emergency = false
    await db.write()
    return reply(event, "緊急OFF")
  }

  if (text === "BANモード" && (isAdmin || isSub)) {
    userState[userId] = "BAN"
    return reply(event, "ユーザーID送信でBAN")
  }

  if (userState[userId] === "BAN") {
    db.data.banList.push(text.trim())
    userState[userId] = null
    await db.write()
    return reply(event, "BAN完了")
  }

  if (text === "通報") {
    db.data.reports[userId] = (db.data.reports[userId] || 0) + 1
    await db.write()
    return reply(event, "通報完了")
  }

  return reply(event, "コマンド不明")
}

// ===== UI =====
function sendMenu(event) {
  return client.replyMessage(event.replyToken, {
    type: "flex",
    altText: "管理パネル",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          btn("通報"),
          btn("BANモード"),
          btn("緊急オン"),
          btn("緊急オフ"),
          btn("設定")
        ]
      }
    }
  })
}

function btn(text) {
  return {
    type: "button",
    action: {
      type: "message",
      label: text,
      text: text
    }
  }
}

function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: "text",
    text
  })
}

app.listen(process.env.PORT || 3000)
