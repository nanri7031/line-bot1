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

// ===== 管理画面 =====
app.get("/", (req, res) => {
  const db = loadDB()

  res.send(`
    <h1>BOT管理</h1>

    <h2>緊急モード: ${db.emergency}</h2>
    <form method="POST" action="/toggle">
      <button name="mode" value="on">ON</button>
      <button name="mode" value="off">OFF</button>
    </form>

    <h2>NGワード</h2>
    <pre>${db.settings.ngWords.join(", ")}</pre>

    <form method="POST" action="/add">
      <input name="word" placeholder="追加"/>
      <button>追加</button>
    </form>

    <h2>BAN</h2>
    <pre>${db.banList.join("<br>")}</pre>

    <h2>ログ</h2>
    <pre>${db.logs.join("<br>")}</pre>
  `)
})

app.post("/toggle", (req, res) => {
  const db = loadDB()
  db.emergency = req.body.mode === "on"
  saveDB(db)
  res.redirect("/")
})

app.post("/add", (req, res) => {
  const db = loadDB()
  db.settings.ngWords.push(req.body.word)
  saveDB(db)
  res.redirect("/")
})

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

// ===== 管理者通知 =====
function notifyAdmins(msg, db) {
  db.admins.forEach(id => {
    client.pushMessage(id, { type: "text", text: msg })
  })
}

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    for (const event of req.body.events) {

      // ===== 新規参加 =====
      if (event.type === "memberJoined") {
        const db = loadDB()
        const userId = event.joined.members[0].userId
        const groupId = event.source.groupId || "private"

        let name = "新規ユーザー"
        try {
          const profile = await client.getGroupMemberProfile(groupId, userId)
          name = profile.displayName
        } catch {}

        if (db.banList.includes(userId)) {
          return client.replyMessage(event.replyToken, {
            type: "text",
            text: "🚫 BANユーザーが参加しました"
          })
        }

        if (!db.joined[userId]) {
          db.joined[userId] = true
          saveDB(db)

          return client.replyMessage(event.replyToken, {
            type: "text",
            text:
              `👣 ようこそ ${name} さん\n\n` +
              `【グループルール】\n` +
              `・荒らし禁止\n` +
              `・NGワード注意\n` +
              `・違反は自動処理\n\n` +
              `📌 ノートのルールを確認して下さい。\n` +
              `確認したらイイね！\n\n` +
              `「メニュー」で操作できます`
          })
        }
      }

      if (event.type !== "message" || event.message.type !== "text") continue

      const text = event.message.text
      const userId = event.source.userId
      const groupId = event.source.groupId || "private"

      const db = loadDB()

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

      // BAN
      if (db.banList.includes(userId)) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚫 制限中"
        })
      }

      // 緊急
      if (db.emergency && !db.admins.includes(userId)) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚨 制限中"
        })
      }

      // ===== スパム検知 =====
      const now = Date.now()
      if (!db.spam[userId]) db.spam[userId] = []
      db.spam[userId].push(now)
      db.spam[userId] = db.spam[userId].filter(t => now - t < 10000)

      if (db.spam[userId].length >= 5) {
        db.banList.push(userId)
        notifyAdmins(`🚫 スパムBAN: ${name}`, db)
        saveDB(db)
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚫 スパムBAN"
        })
      }

      // ===== NG =====
      if (group.ngWords.some(w => text.includes(w))) {
        db.counts[userId] = (db.counts[userId] || 0) + 1

        if (db.counts[userId] >= db.settings.autoBan) {
          db.banList.push(userId)
          notifyAdmins(`🚫 NG BAN: ${name}`, db)
          saveDB(db)
          return client.replyMessage(event.replyToken, {
            type: "text",
            text: "🚫 BAN"
          })
        }

        saveDB(db)
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `⚠️ NG (${db.counts[userId]})`
        })
      }

      // ===== 通報 =====
      if (text === "通報") {
        db.reports[userId] = (db.reports[userId] || 0) + 1

        if (db.reports[userId] >= db.settings.reportBan) {
          db.banList.push(userId)
          notifyAdmins(`🚫 通報BAN: ${name}`, db)
          saveDB(db)
          return client.replyMessage(event.replyToken, {
            type: "text",
            text: "🚫 通報BAN"
          })
        }

        saveDB(db)
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "通報受付"
        })
      }

      // ===== UI =====
      if (text === "メニュー") {
        return client.replyMessage(event.replyToken, menuUI())
      }

      if (text === "設定") {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `NG: ${group.ngWords.join(", ")}`
        })
      }

      // ===== 会話 =====
      function rand(arr) {
        return arr[Math.floor(Math.random() * arr.length)]
      }

      const patterns = [
        { k: ["こんにちは"], r: ["こんにちは！", "やあ👋"] },
        { k: ["おはよう"], r: ["おはよう☀️"] },
        { k: ["暇"], r: ["それな😎", "何する？"] },
        { k: ["ありがとう"], r: ["どういたしまして！"] }
      ]

      for (const p of patterns) {
        if (p.k.some(k => text.includes(k))) {
          return client.replyMessage(event.replyToken, {
            type: "text",
            text: rand(p.r)
          })
        }
      }

      if (Math.random() < 0.2) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: rand(["なるほど", "いいね👍", "草"])
        })
      }

      saveDB(db)

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "OK"
      })
    }

    res.sendStatus(200)
  } catch (e) {
    console.log(e)
    res.sendStatus(500)
  }
})

app.listen(process.env.PORT || 3000)
