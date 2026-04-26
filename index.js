import express from "express"
import line from "@line/bot-sdk"
import fs from "fs"

const app = express()
app.use(express.urlencoded({ extended: true }))

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)

// ===== DB =====
const DB_FILE = "./db.json"

function initDB() {
  return {
    admins: ["U1a1aca9e44466f8cb05003d7dc86fee0"],
    banList: [],
    reports: {},
    counts: {},
    spam: {},
    logs: [],
    joined: {},
    emergency: false,
    groups: {},
    settings: {
      autoBan: 3,
      reportBan: 3,
      ngWords: ["死ね", "荒らし"]
    }
  }
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(initDB(), null, 2))
    }
    return JSON.parse(fs.readFileSync(DB_FILE))
  } catch {
    return initDB()
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

// ===== 管理者通知 =====
function notifyAdmins(msg, db) {
  db.admins.forEach(id => {
    client.pushMessage(id, { type: "text", text: msg })
  })
}

// ===== UI =====
function menuUI() {
  return {
    type: "flex",
    altText: "管理",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "管理パネル", weight: "bold" },
          btn("設定"),
          btn("緊急ON"),
          btn("緊急OFF"),
          btn("通報")
        ]
      }
    }
  }
}

function btn(text) {
  return {
    type: "button",
    action: { type: "message", label: text, text }
  }
}

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    for (const event of req.body.events) {

      const db = loadDB()

      // ===== 参加 =====
      if (event.type === "memberJoined") {
        const userId = event.joined.members[0].userId
        const groupId = event.source.groupId

        let name = "新規ユーザー"
        try {
          const p = await client.getGroupMemberProfile(groupId, userId)
          name = p.displayName
        } catch {}

        if (db.banList.includes(userId)) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "🚫 BANユーザー参加"
          })
          continue
        }

        if (!db.joined[userId]) {
          db.joined[userId] = true
          saveDB(db)

          await client.replyMessage(event.replyToken, {
            type: "text",
            text:
              `👣 ようこそ ${name} さん\n\n` +
              `・荒らし禁止\n・NG注意\n\n` +
              `📌 ノート確認してイイね！\n\n` +
              `「メニュー」で操作`
          })
          continue
        }
      }

      // ===== メッセージ以外無視 =====
      if (event.type !== "message" || event.message.type !== "text") continue

      const text = event.message.text
      const userId = event.source.userId
      const groupId = event.source.groupId || "private"

      if (!db.groups[groupId]) {
        db.groups[groupId] = {
          ngWords: [...db.settings.ngWords]
        }
      }

      const group = db.groups[groupId]

      // 名前取得
      let name = "不明"
      try {
        const p = groupId === "private"
          ? await client.getProfile(userId)
          : await client.getGroupMemberProfile(groupId, userId)
        name = p.displayName
      } catch {}

      // ログ
      db.logs.push(`${name}: ${text}`)
      if (db.logs.length > 50) db.logs.shift()

      // ===== BAN =====
      if (db.banList.includes(userId)) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚫 制限中"
        })
        continue
      }

      // ===== 緊急 =====
      if (db.emergency && !db.admins.includes(userId)) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚨 制限中"
        })
        continue
      }

      // ===== スパム =====
      const now = Date.now()
      if (!db.spam[userId]) db.spam[userId] = []
      db.spam[userId].push(now)
      db.spam[userId] = db.spam[userId].filter(t => now - t < 10000)

      if (db.spam[userId].length >= 5) {
        db.banList.push(userId)
        notifyAdmins(`🚫 スパムBAN: ${name}`, db)
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚫 スパムBAN"
        })
        continue
      }

      // ===== NG =====
      if (group.ngWords.some(w => text.includes(w))) {
        db.counts[userId] = (db.counts[userId] || 0) + 1

        if (db.counts[userId] >= db.settings.autoBan) {
          db.banList.push(userId)
          notifyAdmins(`🚫 NG BAN: ${name}`, db)
          saveDB(db)

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "🚫 BAN"
          })
          continue
        }

        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `⚠️ NG (${db.counts[userId]})`
        })
        continue
      }

      // ===== 通報 =====
      if (text === "通報") {
        db.reports[userId] = (db.reports[userId] || 0) + 1

        if (db.reports[userId] >= db.settings.reportBan) {
          db.banList.push(userId)
          notifyAdmins(`🚫 通報BAN: ${name}`, db)
          saveDB(db)

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "🚫 通報BAN"
          })
          continue
        }

        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "通報受付"
        })
        continue
      }

      // ===== UI =====
      if (text === "メニュー") {
        await client.replyMessage(event.replyToken, menuUI())
        continue
      }

      if (text === "設定") {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `NG: ${group.ngWords.join(", ")}`
        })
        continue
      }

      // ===== 会話 =====
      if (text.includes("こんにちは")) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "こんにちは！"
        })
        continue
      }

      if (Math.random() < 0.2) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: ["いいね👍", "それな", "草"][Math.floor(Math.random()*3)]
        })
        continue
      }

      // ===== デフォルト =====
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
