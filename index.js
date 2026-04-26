import express from "express"
import line from "@line/bot-sdk"
import fs from "fs"

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)

const DB_FILE = "./db.json"

// ===== DB =====
function initDB() {
  return {
    admins: [],
    globalBan: [],
    groups: {}
  }
}

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(initDB(), null, 2))
  }
  return JSON.parse(fs.readFileSync(DB_FILE))
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

function isManager(id, db) {
  return db.admins.includes(id)
}

function getGroup(db, id) {
  if (!db.groups[id]) {
    db.groups[id] = {
      emergency: false,
      welcome: "ようこそ！ルール確認してね"
    }
  }
  return db.groups[id]
}

let registerMode = { active: false, expires: 0 }

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    console.log("イベント受信:", JSON.stringify(req.body))

    for (const event of req.body.events) {

      const db = loadDB()

      // ===== 参加 =====
      if (event.type === "memberJoined") {
        console.log("参加検知")

        const groupId = event.source.groupId
        const group = getGroup(db, groupId)

        await client.pushMessage(groupId, {
          type: "text",
          text: group.welcome
        })
        continue
      }

      if (event.type !== "message") continue
      if (event.message.type !== "text") continue

      const text = event.message.text.trim()
      const userId = event.source.userId
      const to = event.source.groupId || userId

      console.log("受信テキスト:", text)

      const group = getGroup(db, to)

      // ===== 管理登録 =====
      if (text.includes("管理登録")) {
        console.log("管理登録トリガー")

        registerMode.active = true
        registerMode.expires = Date.now() + 30000

        await client.pushMessage(to, {
          type: "text",
          text: "30秒以内に発言で管理者登録"
        })
        continue
      }

      if (registerMode.active && Date.now() < registerMode.expires) {
        console.log("管理者登録実行")

        if (!db.admins.includes(userId)) {
          db.admins.push(userId)
          saveDB(db)

          await client.pushMessage(to, {
            type: "text",
            text: "👑 管理者登録完了"
          })
        }

        registerMode.active = false
      }

      // ===== 緊急 =====
      if (text === "緊急ON" && isManager(userId, db)) {
        group.emergency = true
        saveDB(db)

        await client.pushMessage(to, {
          type: "text",
          text: "🚨 緊急ON"
        })
        continue
      }

      if (text === "緊急OFF" && isManager(userId, db)) {
        group.emergency = false
        saveDB(db)

        await client.pushMessage(to, {
          type: "text",
          text: "解除"
        })
        continue
      }

      if (group.emergency && !isManager(userId, db)) {
        await client.pushMessage(to, {
          type: "text",
          text: "🚫 発言禁止中"
        })
        continue
      }

      // ===== メニュー =====
      if (text.includes("メニュー")) {
        console.log("メニュー反応")

        await client.pushMessage(to, {
          type: "text",
          text: "メニュー動作OK"
        })
        continue
      }

      // ===== デフォルト =====
      await client.pushMessage(to, {
        type: "text",
        text: "受信OK"
      })
    }

    res.sendStatus(200)
  } catch (e) {
    console.log("エラー:", e)
    res.sendStatus(500)
  }
})

app.listen(process.env.PORT || 3000)
