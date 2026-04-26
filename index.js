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
  return { groups: {} }
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

// ===== グループ =====
function getGroup(db, gid) {
  if (!db.groups[gid]) {
    db.groups[gid] = {
      admins: [],
      subAdmins: [],
      ban: [],
      banNames: {},
      reports: {},
      ngWords: ["死ね", "荒らし"],
      emergency: false
    }
  }
  return db.groups[gid]
}

// ===== 権限 =====
function isManager(uid, group) {
  return group.admins.includes(uid) || group.subAdmins.includes(uid)
}

// ===== 状態 =====
let registerMode = {}
let reportMode = {}

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    for (const event of req.body.events) {

      if (event.type !== "message" || event.message.type !== "text") continue

      const db = loadDB()

      const text = event.message.text.trim()
      const uid = event.source.userId
      const gid = event.source.groupId || uid

      const group = getGroup(db, gid)

      // ===== 名前取得 =====
      let name = "ユーザー"
      try {
        if (event.source.groupId) {
          const p = await client.getGroupMemberProfile(gid, uid)
          name = p.displayName
        }
      } catch {}

      // ===== BANチェック =====
      if (group.ban.includes(uid)) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚫 BANされています"
        })
        continue
      }

      // ===== 通報モード =====
      if (text === "通報ON") {
        if (!isManager(uid, group)) {
          await client.replyMessage(event.replyToken, { type: "text", text: "権限なし" })
          continue
        }

        reportMode[gid] = true

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "次の発言者を通報対象"
        })
        continue
      }

      if (reportMode[gid] && !isManager(uid, group)) {
        group.reports[uid] = (group.reports[uid] || 0) + 1

        if (group.reports[uid] >= 2) {
          group.ban.push(uid)
          group.banNames[uid] = name
        }

        reportMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `通報：${name} (${group.reports[uid]}回)`
        })
        continue
      }

      // ===== 管理登録 =====
      if (text === "管理登録") {
        if (!isManager(uid, group)) {
          await client.replyMessage(event.replyToken, { type: "text", text: "権限なし" })
          continue
        }

        registerMode[gid] = { role: "admin", by: uid }

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "次の発言者を管理者に登録"
        })
        continue
      }

      if (text === "副管理登録") {
        if (!isManager(uid, group)) {
          await client.replyMessage(event.replyToken, { type: "text", text: "権限なし" })
          continue
        }

        registerMode[gid] = { role: "sub", by: uid }

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "次の発言者を副管理に登録"
        })
        continue
      }

      if (text === "管理削除") {
        if (!isManager(uid, group)) {
          await client.replyMessage(event.replyToken, { type: "text", text: "権限なし" })
          continue
        }

        registerMode[gid] = { role: "delete" }

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "次の発言者を管理から削除"
        })
        continue
      }

      if (registerMode[gid] && uid !== registerMode[gid].by) {

        if (registerMode[gid].role === "admin") {
          if (!group.admins.includes(uid)) group.admins.push(uid)
        }

        if (registerMode[gid].role === "sub") {
          if (!group.subAdmins.includes(uid)) group.subAdmins.push(uid)
        }

        if (registerMode[gid].role === "delete") {
          group.admins = group.admins.filter(id => id !== uid)
          group.subAdmins = group.subAdmins.filter(id => id !== uid)
        }

        delete registerMode[gid]
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "完了"
        })
        continue
      }

      // ===== NGワード =====
      if (group.ngWords.some(w => text.includes(w))) {
        group.ban.push(uid)
        group.banNames[uid] = name
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `🔨 ${name} BAN`
        })
        continue
      }

      // ===== BAN一覧 =====
      if (text === "BAN一覧") {
        const list = Object.values(group.banNames).join("\n") || "なし"

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: list
        })
        continue
      }

      // ===== BAN解除 =====
      if (text === "BAN解除") {
        if (!isManager(uid, group)) {
          await client.replyMessage(event.replyToken, { type: "text", text: "権限なし" })
          continue
        }

        group.ban = []
        group.banNames = {}
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "全解除"
        })
        continue
      }

      // ===== メニュー（完全Flex版） =====
      if (text === "メニュー") {
        await client.replyMessage(event.replyToken, {
          type: "flex",
          altText: "管理パネル",
          contents: {
            type: "bubble",
            header: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "text",
                  text: "🛠 管理パネル",
                  color: "#ffffff",
                  weight: "bold"
                }
              ],
              backgroundColor: "#1565C0"
            },
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              contents: [
                { type: "button", style: "primary", color: "#1976D2", action: { type: "message", label: "👑 管理登録", text: "管理登録" } },
                { type: "button", style: "primary", color: "#1E88E5", action: { type: "message", label: "👥 副管理登録", text: "副管理登録" } },
                { type: "button", style: "primary", color: "#42A5F5", action: { type: "message", label: "🗑 管理削除", text: "管理削除" } },
                { type: "button", style: "primary", color: "#E53935", action: { type: "message", label: "🚨 通報ON", text: "通報ON" } },
                { type: "button", action: { type: "message", label: "📄 BAN一覧", text: "BAN一覧" } },
                { type: "button", action: { type: "message", label: "🔓 BAN解除", text: "BAN解除" } }
              ]
            }
          }
        })
        continue
      }

      // ===== デフォルト =====
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: "OK"
      })
    }

    res.sendStatus(200)
  } catch (err) {
    console.log(err)
    res.sendStatus(500)
  }
})

app.listen(process.env.PORT || 3000)
