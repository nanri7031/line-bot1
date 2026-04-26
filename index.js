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
    admins: ["ここを自分のユーザーIDに変える"],
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

// ===== グループ設定 =====
function getGroup(db, groupId) {
  if (!db.groups[groupId]) {
    db.groups[groupId] = {
      ngWords: ["死ね", "荒らし"]
    }
  }
  return db.groups[groupId]
}

// ===== 擬似キック =====
async function pseudoKick(userId, name, groupId, db) {
  if (isManager(userId, db)) return

  if (!db.globalBan.includes(userId)) {
    db.globalBan.push(userId)
  }

  saveDB(db)

  await client.pushMessage(groupId, {
    type: "text",
    text: `🔨 ${name} をBANしました`
  })
}

// ===== UI =====
function btn(label, text) {
  return {
    type: "button",
    style: "primary",
    action: { type: "message", label, text }
  }
}

function menuUI() {
  return {
    type: "flex",
    altText: "メニュー",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "🛠 管理メニュー", weight: "bold", size: "lg" },
          {
            type: "box",
            layout: "horizontal",
            contents: [btn("通報", "通報"), btn("設定", "設定")]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [btn("BAN解除", "BAN解除")]
          }
        ]
      }
    }
  }
}

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    for (const event of req.body.events) {

      if (event.type !== "message" || event.message.type !== "text") continue

      const db = loadDB()

      const text = event.message.text
      const userId = event.source.userId
      const groupId = event.source.groupId || userId

      const group = getGroup(db, groupId)

      let name = "ユーザー"
      try {
        const p = await client.getGroupMemberProfile(groupId, userId)
        name = p.displayName
      } catch {}

      // BANチェック
      if (db.globalBan.includes(userId)) {
        await client.pushMessage(groupId, {
          type: "text",
          text: "🚫 BANされています"
        })
        continue
      }

      // NG判定
      if (group.ngWords.some(w => text.includes(w))) {
        await pseudoKick(userId, name, groupId, db)
        continue
      }

      // メニュー
      if (text === "メニュー") {
        await client.pushMessage(groupId, menuUI())
        continue
      }

      // 設定
      if (text === "設定") {
        await client.pushMessage(groupId, {
          type: "text",
          text: "設定：NG一覧 / 管理"
        })
        continue
      }

      // NG一覧
      if (text === "NG一覧") {
        await client.pushMessage(groupId, {
          type: "text",
          text: group.ngWords.join("\n")
        })
        continue
      }

      // 通報
      if (text === "通報") {
        await client.pushMessage(groupId, {
          type: "text",
          text: "通報は管理者へ"
        })
        continue
      }

      await client.pushMessage(groupId, {
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
