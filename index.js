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
    reports: {},
    recentUsers: {},
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

// ===== 管理者登録モード =====
let registerMode = {
  active: false,
  expires: 0
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
            contents: [btn("BAN解除", "BAN解除パネル"), btn("管理", "管理UI")]
          }
        ]
      }
    }
  }
}

function settingUI() {
  return {
    type: "flex",
    altText: "設定",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "⚙️ 設定", weight: "bold" },
          btn("NG一覧", "NG一覧"),
          btn("管理", "管理UI")
        ]
      }
    }
  }
}

function adminUI() {
  return {
    type: "flex",
    altText: "管理",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "👑 管理", weight: "bold" },
          btn("副管理追加", "副管理追加"),
          btn("管理一覧", "管理一覧")
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

      // ===== 管理登録モードON =====
      if (text === "管理登録") {
        registerMode.active = true
        registerMode.expires = Date.now() + 30000

        await client.pushMessage(groupId, {
          type: "text",
          text: "30秒以内に発言した人を管理者登録します"
        })
        continue
      }

      // ===== 管理者登録 =====
      if (registerMode.active && Date.now() < registerMode.expires) {
        if (!db.admins.includes(userId)) {
          db.admins.push(userId)
          saveDB(db)

          await client.pushMessage(groupId, {
            type: "text",
            text: "👑 管理者登録完了"
          })
        }
        registerMode.active = false
      }

      // ===== 最近ユーザー =====
      if (!db.recentUsers[groupId]) db.recentUsers[groupId] = []
      db.recentUsers[groupId].push({ id: userId, name })
      db.recentUsers[groupId] = db.recentUsers[groupId].slice(-5)

      // ===== BAN =====
      if (db.globalBan.includes(userId)) {
        await client.pushMessage(groupId, {
          type: "text",
          text: "🚫 BANされています"
        })
        continue
      }

      // ===== NG =====
      if (group.ngWords.some(w => text.includes(w))) {
        await pseudoKick(userId, name, groupId, db)
        continue
      }

      // ===== メニュー =====
      if (text === "メニュー") {
        await client.pushMessage(groupId, menuUI())
        continue
      }

      // ===== 設定 =====
      if (text === "設定") {
        await client.pushMessage(groupId, settingUI())
        continue
      }

      // ===== NG一覧 =====
      if (text === "NG一覧") {
        await client.pushMessage(groupId, {
          type: "text",
          text: group.ngWords.join("\n")
        })
        continue
      }

      // ===== 管理UI =====
      if (text === "管理UI") {
        if (!isManager(userId, db)) return
        await client.pushMessage(groupId, adminUI())
        continue
      }

      // ===== 副管理追加 =====
      if (text.startsWith("副管理追加 ")) {
        if (!isManager(userId, db)) return
        const id = text.split(" ")[1]

        db.subAdmins.push(id)
        saveDB(db)

        await client.pushMessage(groupId, {
          type: "text",
          text: "副管理追加完了"
        })
        continue
      }

      // ===== 管理一覧 =====
      if (text === "管理一覧") {
        await client.pushMessage(groupId, {
          type: "text",
          text:
            "管理者\n" + db.admins.join("\n") +
            "\n副管理\n" + db.subAdmins.join("\n")
        })
        continue
      }

      // ===== BAN解除UI =====
      if (text === "BAN解除パネル") {
        if (!isManager(userId, db)) return

        await client.pushMessage(groupId, {
          type: "text",
          text: db.globalBan.join("\n") || "なし"
        })
        continue
      }

      // ===== 通報 =====
      if (text === "通報") {
        await client.pushMessage(groupId, {
          type: "text",
          text: "通報: 通報ID Uxxxx"
        })
        continue
      }

      if (text.startsWith("通報ID ")) {
        const target = text.split(" ")[1]

        db.reports[target] = (db.reports[target] || 0) + 1

        if (db.reports[target] >= 3) {
          db.globalBan.push(target)
          saveDB(db)

          await client.pushMessage(groupId, {
            type: "text",
            text: "🚫 通報BAN"
          })
          continue
        }

        await client.pushMessage(groupId, {
          type: "text",
          text: "通報完了"
        })
        continue
      }

      // ===== デフォルト =====
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
