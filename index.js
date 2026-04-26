import express from "express"
import line from "@line/bot-sdk"
import fs from "fs"

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)

// ===== DB（絶対落ちない構造）=====
const DB_FILE = "./db.json"

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({
        admins: ["U1a1aca9e44466f8cb05003d7dc86fee0"],
        subAdmins: [],
        banList: [],
        reports: {},
        emergency: false,
        settings: {
          autoBan: 3,
          ngWords: ["死ね", "荒らし"]
        }
      }, null, 2))
    }
    return JSON.parse(fs.readFileSync(DB_FILE))
  } catch {
    return {}
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events

    for (const event of events) {
      if (event.type !== "message" || event.message.type !== "text") continue

      const text = event.message.text
      const userId = event.source.userId

      let db = loadDB()

      // ===== NGワード検知 =====
      if (db.settings.ngWords.some(w => text.includes(w))) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "⚠️ NGワード検出"
        })
      }

      // ===== メニューUI =====
      if (text === "メニュー") {
        return client.replyMessage(event.replyToken, {
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
                  text: "⚙️ 管理パネル",
                  weight: "bold",
                  size: "lg"
                },
                {
                  type: "button",
                  style: "primary",
                  action: {
                    type: "message",
                    label: "📊 設定",
                    text: "設定"
                  }
                },
                {
                  type: "button",
                  style: "secondary",
                  action: {
                    type: "message",
                    label: "🚨 緊急ON",
                    text: "緊急ON"
                  }
                },
                {
                  type: "button",
                  style: "secondary",
                  action: {
                    type: "message",
                    label: "✅ 緊急OFF",
                    text: "緊急OFF"
                  }
                }
              ]
            }
          }
        })
      }

      // ===== 設定表示 =====
      if (text === "設定") {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `【設定】
自動BAN回数: ${db.settings.autoBan}
NGワード: ${db.settings.ngWords.join(", ")}`
        })
      }

      // ===== 緊急モード =====
      if (text === "緊急ON") {
        if (!db.admins.includes(userId)) {
          return client.replyMessage(event.replyToken, {
            type: "text",
            text: "❌ 管理者のみ"
          })
        }

        db.emergency = true
        saveDB(db)

        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚨 緊急モードON"
        })
      }

      if (text === "緊急OFF") {
        if (!db.admins.includes(userId)) {
          return client.replyMessage(event.replyToken, {
            type: "text",
            text: "❌ 管理者のみ"
          })
        }

        db.emergency = false
        saveDB(db)

        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "✅ 緊急モードOFF"
        })
      }

      // ===== NG追加 =====
      if (text.startsWith("NG追加 ")) {
        if (!db.admins.includes(userId)) return

        const word = text.replace("NG追加 ", "")
        db.settings.ngWords.push(word)
        saveDB(db)

        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `追加: ${word}`
        })
      }

      // ===== NG削除 =====
      if (text.startsWith("NG削除 ")) {
        if (!db.admins.includes(userId)) return

        const word = text.replace("NG削除 ", "")
        db.settings.ngWords = db.settings.ngWords.filter(w => w !== word)
        saveDB(db)

        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `削除: ${word}`
        })
      }

      // ===== デフォルト返信 =====
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "コマンド不明"
      })
    }

    res.sendStatus(200)
  } catch (e) {
    console.log(e)
    res.sendStatus(500)
  }
})

app.get("/", (req, res) => {
  res.send("BOT起動中")
})

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running")
})
