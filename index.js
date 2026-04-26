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

// DB設定
const adapter = new JSONFile("db.json")
const db = new Low(adapter)

await db.read()

db.data ||= {
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
}

await db.write()

// Webhook
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent))
    res.sendStatus(200)
  } catch (err) {
    console.error(err)
    res.sendStatus(500)
  }
})

// メイン処理
async function handleEvent(event) {
  try {
    if (event.type !== "message") return Promise.resolve(null)
    if (event.message.type !== "text") return Promise.resolve(null)

    const text = event.message.text
    const userId = event.source.userId || null
    const groupId = event.source.groupId || "default"

    if (!userId) return

    // DB初期化（グループ別）
    if (!db.data.groups) db.data.groups = {}

    if (!db.data.groups[groupId]) {
      db.data.groups[groupId] = {
        ngWords: [...db.data.settings.ngWords],
        counts: {}
      }
    }

    const group = db.data.groups[groupId]

    // プロフィール取得
    let userName = "不明"
    try {
      const profile = await client.getProfile(userId)
      userName = profile.displayName
    } catch {}

    // 権限
    const isAdmin = db.data.admins.includes(userId)
    const isSub = db.data.subAdmins.includes(userId)

    // ===== メニュー =====
    if (text === "メニュー") {
      return reply(event.replyToken, {
        type: "template",
        altText: "管理メニュー",
        template: {
          type: "buttons",
          title: "管理パネル",
          text: "操作を選択",
          actions: [
            { type: "message", label: "⚙ 設定", text: "設定" },
            { type: "message", label: "🚨 緊急ON", text: "緊急ON" },
            { type: "message", label: "🟢 緊急OFF", text: "緊急OFF" },
            { type: "message", label: "📩 通報一覧", text: "通報一覧" }
          ]
        }
      })
    }

    // ===== 設定 =====
    if (text === "設定") {
      return reply(event.replyToken, {
        type: "text",
        text:
          `【設定】\n` +
          `自動BAN: ${db.data.settings.autoBan}\n` +
          `NGワード: ${group.ngWords.join(", ")}`
      })
    }

    // ===== NG追加 =====
    if (text.startsWith("NG追加") && (isAdmin || isSub)) {
      const words = text.replace("NG追加", "").trim().split(/[,、]/)
      group.ngWords.push(...words)
      await db.write()

      return reply(event.replyToken, {
        type: "text",
        text: `追加: ${words.join(", ")}`
      })
    }

    // ===== NG削除 =====
    if (text.startsWith("NG削除") && (isAdmin || isSub)) {
      const words = text.replace("NG削除", "").trim().split(/[,、]/)
      group.ngWords = group.ngWords.filter(w => !words.includes(w))
      await db.write()

      return reply(event.replyToken, {
        type: "text",
        text: `削除: ${words.join(", ")}`
      })
    }

    // ===== 緊急 =====
    if (text === "緊急ON" && isAdmin) {
      db.data.emergency = true
      await db.write()
      return reply(event.replyToken, { type: "text", text: "🚨 緊急モードON" })
    }

    if (text === "緊急OFF" && isAdmin) {
      db.data.emergency = false
      await db.write()
      return reply(event.replyToken, { type: "text", text: "🟢 緊急モードOFF" })
    }

    // ===== 緊急時制限 =====
    if (db.data.emergency && !isAdmin) {
      return reply(event.replyToken, {
        type: "text",
        text: "🚫 現在制限中"
      })
    }

    // ===== NGチェック =====
    if (group.ngWords.some(w => text.includes(w))) {
      group.counts[userId] = (group.counts[userId] || 0) + 1

      await db.write()

      if (group.counts[userId] >= db.data.settings.autoBan) {
        db.data.banList.push(userId)
        await db.write()

        return reply(event.replyToken, {
          type: "text",
          text: `🚫 BAN: ${userName}`
        })
      }

      return reply(event.replyToken, {
        type: "text",
        text: `⚠️ ${userName} NG (${group.counts[userId]})`
      })
    }

    // ===== 通報 =====
    if (text === "通報") {
      db.data.reports[userId] = (db.data.reports[userId] || 0) + 1
      await db.write()

      return reply(event.replyToken, {
        type: "text",
        text: "通報受付"
      })
    }

    // ===== デフォルト =====
    return reply(event.replyToken, {
      type: "text",
      text: "コマンド不明"
    })

  } catch (err) {
    console.error("EVENT ERROR:", err)
    return Promise.resolve(null)
  }
}

// 安全reply
async function reply(token, message) {
  try {
    return await client.replyMessage(token, message)
  } catch (e) {
    console.log("reply error", e)
  }
}

// サーバー起動
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running"))
