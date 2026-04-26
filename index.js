import express from "express"
import line from "@line/bot-sdk"
import dotenv from "dotenv"
import { Low } from "lowdb"
import { JSONFile } from "lowdb/node"

dotenv.config()
const app = express()

// =====================
// LINE設定
// =====================
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}
const client = new line.Client(config)

// =====================
// DB（←ここが重要修正）
// =====================
const adapter = new JSONFile("db.json")

const defaultData = {
  admins: ["U1a1aca9e44466f8cb05003d7dc86fee0"],
  subAdmins: [],
  banList: [],
  reports: {},
  userCounts: {},
  emergency: false,
  groups: {},
  settings: {
    autoBan: 3,
    ngWords: ["死ね", "荒らし"]
  }
}

// ★これが絶対必要
const db = new Low(adapter, defaultData)

await db.read()

// 初回対策
if (!db.data) {
  db.data = defaultData
}

await db.write()

// =====================
// Webhook
// =====================
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent))
    res.sendStatus(200)
  } catch (err) {
    console.error(err)
    res.sendStatus(500)
  }
})

// =====================
// メニューUI
// =====================
function menu() {
  return {
    type: "template",
    altText: "管理メニュー",
    template: {
      type: "buttons",
      title: "管理パネル",
      text: "選択",
      actions: [
        { type: "message", label: "設定", text: "設定" },
        { type: "message", label: "緊急ON", text: "緊急ON" },
        { type: "message", label: "緊急OFF", text: "緊急OFF" },
        { type: "message", label: "通報", text: "通報" }
      ]
    }
  }
}

// =====================
// メイン処理
// =====================
async function handleEvent(event) {
  try {
    if (event.type !== "message") return Promise.resolve(null)
    if (event.message.type !== "text") return Promise.resolve(null)

    const text = event.message.text
    const userId = event.source.userId || null
    const groupId = event.source.groupId || "default"

    if (!userId) return

    await db.read()

    // グループ初期化
    if (!db.data.groups[groupId]) {
      db.data.groups[groupId] = {
        ngWords: [...db.data.settings.ngWords],
        counts: {}
      }
    }

    const group = db.data.groups[groupId]

    // ユーザー名
    let userName = "不明"
    try {
      const profile = await client.getProfile(userId)
      userName = profile.displayName
    } catch {}

    const isAdmin = db.data.admins.includes(userId)
    const isSub = db.data.subAdmins.includes(userId)

    // =====================
    // メニュー
    // =====================
    if (text === "メニュー") {
      return safeReply(event.replyToken, menu())
    }

    // =====================
    // 設定
    // =====================
    if (text === "設定") {
      return safeReply(event.replyToken, {
        type: "text",
        text:
          `【設定】\nNG: ${group.ngWords.join(", ")}\n回数: ${db.data.settings.autoBan}`
      })
    }

    // =====================
    // NG追加
    // =====================
    if (text.startsWith("NG追加") && (isAdmin || isSub)) {
      const words = text.replace("NG追加", "").trim().split(/[,、]/)
      group.ngWords.push(...words)
      await db.write()

      return safeReply(event.replyToken, {
        type: "text",
        text: `追加: ${words.join(", ")}`
      })
    }

    // =====================
    // NG削除
    // =====================
    if (text.startsWith("NG削除") && (isAdmin || isSub)) {
      const words = text.replace("NG削除", "").trim().split(/[,、]/)
      group.ngWords = group.ngWords.filter(w => !words.includes(w))
      await db.write()

      return safeReply(event.replyToken, {
        type: "text",
        text: `削除: ${words.join(", ")}`
      })
    }

    // =====================
    // 緊急
    // =====================
    if (text === "緊急ON" && isAdmin) {
      db.data.emergency = true
      await db.write()
      return safeReply(event.replyToken, { type: "text", text: "ON" })
    }

    if (text === "緊急OFF" && isAdmin) {
      db.data.emergency = false
      await db.write()
      return safeReply(event.replyToken, { type: "text", text: "OFF" })
    }

    if (db.data.emergency && !isAdmin) {
      return safeReply(event.replyToken, {
        type: "text",
        text: "🚨制限中"
      })
    }

    // =====================
    // NG検知
    // =====================
    if (group.ngWords.some(w => text.includes(w))) {
      group.counts[userId] = (group.counts[userId] || 0) + 1
      await db.write()

      if (group.counts[userId] >= db.data.settings.autoBan) {
        db.data.banList.push(userId)
        await db.write()

        return safeReply(event.replyToken, {
          type: "text",
          text: `🚫BAN: ${userName}`
        })
      }

      return safeReply(event.replyToken, {
        type: "text",
        text: `⚠️ ${userName} NG (${group.counts[userId]})`
      })
    }

    // =====================
    // 通報
    // =====================
    if (text === "通報") {
      db.data.reports[userId] = (db.data.reports[userId] || 0) + 1
      await db.write()

      return safeReply(event.replyToken, {
        type: "text",
        text: "通報完了"
      })
    }

    return safeReply(event.replyToken, {
      type: "text",
      text: "コマンド不明"
    })

  } catch (err) {
    console.error("ERROR:", err)
    return Promise.resolve(null)
  }
}

// =====================
// 安全返信
// =====================
async function safeReply(token, message) {
  try {
    return await client.replyMessage(token, message)
  } catch (e) {
    console.log("reply error", e)
  }
}

// =====================
// 起動
// =====================
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running")
})
