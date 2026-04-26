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
    subAdmins: [],
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

// ===== 権限 =====
function isAdmin(id, db) {
  return db.admins.includes(id)
}

function isManager(id, db) {
  return db.admins.includes(id) || db.subAdmins.includes(id)
}

// ===== グループ =====
function getGroup(db, id) {
  if (!db.groups[id]) {
    db.groups[id] = {
      ngWords: ["死ね", "荒らし"],
      emergency: false,
      welcome: "ようこそ！ルール確認してね",
      scores: {}
    }
  }
  return db.groups[id]
}

// ===== 管理登録 =====
let registerMode = { active: false, expires: 0 }

// ===== BAN =====
function addScore(group, userId) {
  if (!group.scores[userId]) group.scores[userId] = 0
  group.scores[userId]++

  return group.scores[userId]
}

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {

    for (const event of req.body.events) {

      const db = loadDB()

      // ===== 参加 =====
      if (event.type === "memberJoined") {
        const gid = event.source.groupId
        const group = getGroup(db, gid)

        await client.pushMessage(gid, {
          type: "text",
          text: group.welcome
        })
        continue
      }

      if (event.type !== "message") continue
      if (event.message.type !== "text") continue

      const text = event.message.text.trim()
      const userId = event.source.userId
      const gid = event.source.groupId || userId

      const group = getGroup(db, gid)

      // ===== BAN済 =====
      if (db.globalBan.includes(userId)) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚫 BANされています"
        })
        return
      }

      // ===== 管理登録 =====
      if (text === "管理登録") {
        registerMode = { active: true, expires: Date.now() + 30000 }

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

      // ===== 緊急 =====
      if (text === "緊急ON" && isManager(userId, db)) {
        group.emergency = true
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚨 緊急ON"
        })
        return
      }

      if (text === "緊急OFF" && isManager(userId, db)) {
        group.emergency = false
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "解除"
        })
        return
      }

      if (group.emergency && !isManager(userId, db)) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚫 発言禁止"
        })
        return
      }

      // ===== NG検知 =====
      if (group.ngWords.some(w => text.includes(w))) {
        const score = addScore(group, userId)

        if (score >= 2) {
          db.globalBan.push(userId)
          saveDB(db)

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "🔨 BANしました"
          })
        } else {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "⚠️ 注意"
          })
        }
        return
      }

      // ===== BAN解除 =====
      if (text === "BAN解除" && isManager(userId, db)) {
        db.globalBan = []
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "BAN解除しました"
        })
        return
      }

      // ===== 管理一覧 =====
      if (text === "管理一覧") {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "管理者数：" + db.admins.length
        })
        return
      }

      // ===== メニュー =====
      if (text.includes("メニュー")) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text:
`📋 管理メニュー
・管理登録
・管理一覧
・緊急ON / OFF
・BAN解除`
        })
        return
      }

      await client.replyMessage(event.replyToken, {
        type: "text",
        text: "受信OK"
      })
    }

    res.sendStatus(200)
  } catch (e) {
    console.log(e)
    res.sendStatus(500)
  }
})

app.listen(process.env.PORT || 3000)
