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
    globalBan: [],
    reports: {},
    counts: {},
    spam: {},
    logs: [],
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

// ===== グループ初期化 =====
function initGroup(db, groupId) {
  if (!db.groups[groupId]) {
    db.groups[groupId] = {
      welcomeMessage: "👣 ようこそ {name} さん！\n📌 ノート確認してイイね！",
      ngWords: ["死ね", "荒らし"],
      autoBan: 3
    }
  }
}

// ===== AI検知 =====
function isToxic(text) {
  return /死ね|殺す|バカ+|(.)\1{5,}|https?:\/\//.test(text)
}

// ===== 擬似キック =====
async function pseudoKick(userId, name, event, db) {
  db.globalBan.push(userId)
  saveDB(db)

  await client.replyMessage(event.replyToken, [
    { type: "text", text: `🔨 ${name} を強制退出しました` },
    { type: "text", text: "🚫 再参加禁止" }
  ])
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
          btn("挨拶確認"),
          btn("設定"),
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

      const groupId = event.source.groupId || "private"
      initGroup(db, groupId)
      const group = db.groups[groupId]

      // ===== 参加 =====
      if (event.type === "memberJoined") {
        const userId = event.joined.members[0].userId

        if (db.globalBan.includes(userId)) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "🚫 BANユーザー"
          })
          continue
        }

        let name = "ユーザー"
        try {
          const p = await client.getGroupMemberProfile(groupId, userId)
          name = p.displayName
        } catch {}

        const msg = group.welcomeMessage.replace("{name}", name)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: msg
        })
        continue
      }

      if (event.type !== "message" || event.message.type !== "text") continue

      const text = event.message.text
      const userId = event.source.userId

      // ===== BAN =====
      if (db.globalBan.includes(userId)) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚫 発言禁止"
        })
        continue
      }

      // ===== AI =====
      if (isToxic(text)) {
        await pseudoKick(userId, "ユーザー", event, db)
        continue
      }

      // ===== スパム =====
      const now = Date.now()
      if (!db.spam[userId]) db.spam[userId] = []
      db.spam[userId].push(now)
      db.spam[userId] = db.spam[userId].filter(t => now - t < 10000)

      if (db.spam[userId].length >= 5) {
        await pseudoKick(userId, "ユーザー", event, db)
        continue
      }

      // ===== NG =====
      if (group.ngWords.some(w => text.includes(w))) {
        db.counts[userId] = (db.counts[userId] || 0) + 1

        if (db.counts[userId] >= group.autoBan) {
          await pseudoKick(userId, "ユーザー", event, db)
          continue
        }

        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `⚠️ NG (${db.counts[userId]})`
        })
        continue
      }

      // ===== 挨拶変更 =====
      if (text.startsWith("挨拶設定 ")) {
        const msg = text.replace("挨拶設定 ", "")
        group.welcomeMessage = msg
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "挨拶更新完了"
        })
        continue
      }

      // ===== 挨拶確認 =====
      if (text === "挨拶確認") {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: group.welcomeMessage
        })
        continue
      }

      // ===== 通報 =====
      if (text.startsWith("通報 ")) {
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

        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "通報受付"
        })
        continue
      }

      // ===== メニュー =====
      if (text === "メニュー") {
        await client.replyMessage(event.replyToken, menuUI())
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
