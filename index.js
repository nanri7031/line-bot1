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
function isManager(id, db) {
  return db.admins.includes(id) || db.subAdmins.includes(id)
}

// ===== グループ =====
function getGroup(db, groupId) {
  if (!db.groups[groupId]) {
    db.groups[groupId] = {
      ngWords: ["死ね", "荒らし"],
      emergency: false,
      welcome: "ようこそ！\nノートのルールを確認して下さい。\n確認しましたら必ずイイねをタップ！"
    }
  }
  return db.groups[groupId]
}

// ===== 管理登録 =====
let registerMode = { active: false, expires: 0 }

// ===== 擬似キック =====
async function pseudoKick(userId, name, to, db) {
  if (isManager(userId, db)) return

  db.globalBan.push(userId)
  saveDB(db)

  await client.pushMessage(to, {
    type: "text",
    text: `🔨 ${name} をBANしました`
  })
}

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

      if (event.type !== "message" || event.message.type !== "text") continue

      const text = event.message.text
      const userId = event.source.userId
      const to = event.source.groupId || userId

      const group = getGroup(db, to)

      // ===== 管理登録 =====
      if (text.includes("管理登録")) {
        registerMode.active = true
        registerMode.expires = Date.now() + 30000

        await client.pushMessage(to, {
          type: "text",
          text: "30秒以内に発言で管理者登録"
        })
        continue
      }

      if (registerMode.active && Date.now() < registerMode.expires) {
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

      // ===== 緊急モード =====
      if (text === "緊急ON" && isManager(userId, db)) {
        group.emergency = true
        saveDB(db)

        await client.pushMessage(to, {
          type: "text",
          text: "🚨 緊急モードON（管理者以外発言禁止）"
        })
        continue
      }

      if (text === "緊急OFF" && isManager(userId, db)) {
        group.emergency = false
        saveDB(db)

        await client.pushMessage(to, {
          type: "text",
          text: "✅ 緊急モード解除"
        })
        continue
      }

      if (group.emergency && !isManager(userId, db)) {
        await client.pushMessage(to, {
          type: "text",
          text: "🚫 現在発言できません"
        })
        continue
      }

      // ===== BAN =====
      if (db.globalBan.includes(userId)) {
        await client.pushMessage(to, {
          type: "text",
          text: "🚫 BANされています"
        })
        continue
      }

      // ===== NG =====
      if (group.ngWords.some(w => text.includes(w))) {
        await pseudoKick(userId, "ユーザー", to, db)
        continue
      }

      // ===== メニュー =====
      if (text.includes("メニュー")) {
        await client.pushMessage(to, {
          type: "text",
          text: "通報 / 設定 / 緊急ON / 緊急OFF"
        })
        continue
      }

      await client.pushMessage(to, {
        type: "text",
        text: "OK"
      })

      saveDB(db)
    }

    res.sendStatus(200)
  } catch (e) {
    console.log(e)
    res.sendStatus(500)
  }
})

app.listen(process.env.PORT || 3000)
