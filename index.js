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
    admins: ["U1a1aca9e44466f8cb05003d7dc86fee0"],
    subAdmins: [],
    globalBan: [],
    scores: {},
    reports: {},
    spam: {},
    recentUsers: {}
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

// ===== NG検知 =====
function isToxic(text) {
  return /死ね|殺す|バカ+|(.)\1{5,}|https?:\/\//.test(text)
}

// ===== スコア =====
function addScore(id, db, val) {
  db.scores[id] = (db.scores[id] || 0) + val
}

// ===== 擬似キック =====
async function pseudoKick(userId, name, event, db) {
  if (isManager(userId, db)) return

  if (!db.globalBan.includes(userId)) {
    db.globalBan.push(userId)
  }

  saveDB(db)

  await client.replyMessage(event.replyToken, [
    { type: "text", text: `🔨 ${name} を強制退出しました` },
    { type: "text", text: "🚫 再参加は禁止されています" }
  ])
}

// ===== 通報UI =====
function reportUI(db, groupId) {
  const users = db.recentUsers[groupId] || []

  return {
    type: "flex",
    altText: "通報",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: users.map(u => ({
          type: "button",
          action: {
            type: "message",
            label: u.name,
            text: `通報ID ${u.id}`
          }
        }))
      }
    }
  }
}

// ===== BAN解除UI =====
function unbanUI(db) {
  return {
    type: "flex",
    altText: "解除",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: db.globalBan.map(id => ({
          type: "button",
          action: {
            type: "message",
            label: id.slice(0, 6),
            text: `UNBAN ${id}`
          }
        }))
      }
    }
  }
}

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    for (const event of req.body.events) {

      const db = loadDB()

      // ===== 参加検知 =====
      if (event.type === "memberJoined") {
        const userId = event.joined.members[0].userId

        if (db.globalBan.includes(userId)) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "🚫 BANユーザー参加検知"
          })
        }
        continue
      }

      if (event.type !== "message" || event.message.type !== "text") continue

      const text = event.message.text
      const userId = event.source.userId
      const groupId = event.source.groupId || "private"

      // ===== 名前取得 =====
      let name = "ユーザー"
      try {
        const p = await client.getGroupMemberProfile(groupId, userId)
        name = p.displayName
      } catch {}

      // ===== 最近ユーザー =====
      if (!db.recentUsers[groupId]) db.recentUsers[groupId] = []
      db.recentUsers[groupId].push({ id: userId, name })
      db.recentUsers[groupId] = db.recentUsers[groupId].slice(-5)

      // ===== BANチェック =====
      if (db.globalBan.includes(userId)) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚫 利用禁止"
        })
        continue
      }

      // ===== NGワード =====
      if (isToxic(text)) {
        addScore(userId, db, -5)
      }

      // ===== スパム =====
      const now = Date.now()
      if (!db.spam[userId]) db.spam[userId] = []
      db.spam[userId].push(now)
      db.spam[userId] = db.spam[userId].filter(t => now - t < 10000)

      if (db.spam[userId].length >= 5) {
        await pseudoKick(userId, name, event, db)
        continue
      }

      // ===== スコアBAN =====
      if ((db.scores[userId] || 0) <= -10) {
        await pseudoKick(userId, name, event, db)
        continue
      }

      // ===== 通報UI =====
      if (text === "通報") {
        await client.replyMessage(event.replyToken, reportUI(db, groupId))
        continue
      }

      // ===== 通報処理 =====
      if (text.startsWith("通報ID ")) {
        const target = text.split(" ")[1]

        db.reports[target] = (db.reports[target] || 0) + 1

        if (db.reports[target] >= 3) {
          db.globalBan.push(target)
          saveDB(db)

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "🚫 通報BAN"
          })
          continue
        }

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "通報完了"
        })
        continue
      }

      // ===== BAN解除 =====
      if (text === "BAN解除パネル") {
        if (!isManager(userId, db)) return
        await client.replyMessage(event.replyToken, unbanUI(db))
        continue
      }

      if (text.startsWith("UNBAN ")) {
        if (!isManager(userId, db)) return

        const id = text.split(" ")[1]
        db.globalBan = db.globalBan.filter(u => u !== id)
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "解除完了"
        })
        continue
      }

      // ===== メンション簡易返信 =====
      const isMentioned =
        event.message.mention &&
        event.message.mention.mentionees?.some(m => m.isSelf)

      if (isMentioned) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "呼びました？"
        })
        continue
      }

      // ===== 通常返信 =====
      await client.replyMessage(event.replyToken, {
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
