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
      adminNames: {},
      ban: [],
      banNames: {},
      reports: {},
      ngWords: [],
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
let ngAddMode = {}
let ngRemoveMode = {}
let banMode = {}

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

      // ===== BAN =====
      if (group.ban.includes(uid)) {
        await client.replyMessage(event.replyToken, { type: "text", text: "🚫 BANされています" })
        continue
      }

      // ===== BANモード =====
      if (text === "BANモード") {
        if (!isManager(uid, group)) {
          await client.replyMessage(event.replyToken, { type: "text", text: "権限なし" })
          continue
        }

        banMode[gid] = true

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "次の発言者をBAN"
        })
        continue
      }

      if (banMode[gid] && !isManager(uid, group)) {
        group.ban.push(uid)
        group.banNames[uid] = name
        banMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `🔨 ${name} をBAN`
        })
        continue
      }

      // ===== NG追加 =====
      if (text === "NG追加") {
        if (!isManager(uid, group)) continue

        ngAddMode[gid] = true

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "追加したいNGワードを送信"
        })
        continue
      }

      if (ngAddMode[gid]) {
        group.ngWords.push(text)
        ngAddMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `NG追加: ${text}`
        })
        continue
      }

      // ===== NG削除 =====
      if (text === "NG削除") {
        if (!isManager(uid, group)) continue

        ngRemoveMode[gid] = true

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `削除したいNGワードを送信\n現在:\n${group.ngWords.join("\n")}`
        })
        continue
      }

      if (ngRemoveMode[gid]) {
        group.ngWords = group.ngWords.filter(w => w !== text)
        ngRemoveMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `削除: ${text}`
        })
        continue
      }

      // ===== NG検知 =====
      if (group.ngWords.some(w => text.includes(w))) {
        group.ban.push(uid)
        group.banNames[uid] = name
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `⚠️ NG → BAN (${name})`
        })
        continue
      }

      // ===== 管理登録 =====
      if (text === "管理登録" && isManager(uid, group)) {
        registerMode[gid] = { role: "admin", by: uid }
        await client.replyMessage(event.replyToken, { type: "text", text: "次の発言者を管理者登録" })
        continue
      }

      if (text === "副管理登録" && isManager(uid, group)) {
        registerMode[gid] = { role: "sub", by: uid }
        await client.replyMessage(event.replyToken, { type: "text", text: "次の発言者を副管理登録" })
        continue
      }

      if (registerMode[gid] && uid !== registerMode[gid].by) {

        if (registerMode[gid].role === "admin") {
          group.admins.push(uid)
          group.adminNames[uid] = name
        }

        if (registerMode[gid].role === "sub") {
          group.subAdmins.push(uid)
          group.adminNames[uid] = name
        }

        delete registerMode[gid]
        saveDB(db)

        await client.replyMessage(event.replyToken, { type: "text", text: "登録完了" })
        continue
      }

      // ===== 管理一覧 =====
      if (text === "管理一覧") {

        const adminList = group.admins.map(id => group.adminNames[id] || id).join("\n") || "なし"
        const subList = group.subAdmins.map(id => group.adminNames[id] || id).join("\n") || "なし"

        await client.replyMessage(event.replyToken, {
          type: "text",
          text:
`👑 管理者
${adminList}

👥 副管理
${subList}`
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
      if (text === "BAN解除" && isManager(uid, group)) {
        group.ban = []
        group.banNames = {}
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "解除完了"
        })
        continue
      }

      // ===== メニュー =====
      if (text === "メニュー") {
        await client.replyMessage(event.replyToken, {
          type: "flex",
          altText: "管理",
          contents: {
            type: "bubble",
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              contents: [
                { type: "button", style: "primary", color: "#1976D2", action: { type: "message", label: "管理登録", text: "管理登録" } },
                { type: "button", style: "primary", color: "#1E88E5", action: { type: "message", label: "副管理登録", text: "副管理登録" } },
                { type: "button", style: "primary", color: "#42A5F5", action: { type: "message", label: "管理一覧", text: "管理一覧" } },
                { type: "button", style: "primary", color: "#E53935", action: { type: "message", label: "BANモード", text: "BANモード" } },
                { type: "button", style: "primary", color: "#FB8C00", action: { type: "message", label: "NG追加", text: "NG追加" } },
                { type: "button", style: "primary", color: "#8E24AA", action: { type: "message", label: "NG削除", text: "NG削除" } },
                { type: "button", style: "primary", color: "#1E88E5", action: { type: "message", label: "BAN一覧", text: "BAN一覧" } },
                { type: "button", style: "primary", color: "#43A047", action: { type: "message", label: "BAN解除", text: "BAN解除" } }
              ]
            }
          }
        })
        continue
      }

      await client.replyMessage(event.replyToken, { type: "text", text: "OK" })
    }

    res.sendStatus(200)
  } catch (e) {
    console.log(e)
    res.sendStatus(500)
  }
})

app.listen(process.env.PORT || 3000)
