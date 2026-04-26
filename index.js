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

function isAdmin(id, db) {
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

// ===== 管理登録 =====
let registerMode = { active: false, expires: 0 }

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {

    for (const event of req.body.events) {

      const db = loadDB()

      // ===== 参加挨拶 =====
      if (event.type === "memberJoined") {
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
      const groupId = event.source.groupId
      const to = groupId || userId

      const group = getGroup(db, to)

      // ===== 管理登録 =====
      if (text === "管理登録") {
        registerMode.active = true
        registerMode.expires = Date.now() + 30000

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "30秒以内に発言で管理者登録"
        })
        return
      }

      if (registerMode.active && Date.now() < registerMode.expires) {
        if (!db.admins.includes(userId)) {
          db.admins.push(userId)
          saveDB(db)

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "👑 管理者登録完了"
          })
        }
        registerMode.active = false
        return
      }

      // ===== 緊急モード =====
      if (text === "緊急ON" && isAdmin(userId, db)) {
        group.emergency = true
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚨 緊急モードON"
        })
        return
      }

      if (text === "緊急OFF" && isAdmin(userId, db)) {
        group.emergency = false
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "✅ 緊急モード解除"
        })
        return
      }

      if (group.emergency && !isAdmin(userId, db)) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚫 現在発言できません"
        })
        return
      }

      // ===== メニュー =====
      if (text.includes("メニュー")) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "📋 管理メニュー\n・管理登録\n・緊急ON\n・緊急OFF"
        })
        return
      }

      // ===== デフォルト =====
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: "受信OK"
      })
    }

    res.sendStatus(200)

  } catch (err) {
    console.log(err)
    res.sendStatus(500)
  }
})

app.listen(process.env.PORT || 3000)
