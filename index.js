import express from "express"
import line from "@line/bot-sdk"
import fs from "fs"

const app = express()

const OWNER_ID = "U1a1aca9e44466f8cb05003d7dc86fee0"

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
      admins: [OWNER_ID],
      subAdmins: [],
      adminNames: {},
      ban: [],
      banNames: {},
      reports: {},
      ngWords: ["死ね", "荒らし"]
    }
  }

  if (!db.groups[gid].admins.includes(OWNER_ID)) {
    db.groups[gid].admins.push(OWNER_ID)
  }

  return db.groups[gid]
}

// ===== 権限 =====
function isManager(uid, group) {
  return group.admins.includes(uid) || group.subAdmins.includes(uid)
}

// ===== 状態 =====
let registerMode = {}
let subRegisterMode = {}
let deleteMode = {}
let banMode = {}
let reportMode = {}
let ngAddMode = {}

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    for (const event of req.body.events) {

      if (event.type !== "message" || event.message.type !== "text") continue

      const db = loadDB()

      const text = event.message.text.trim()
      const uid = event.source.userId
      const gid = event.source.groupId || uid

      const group = getGroup(db, gid)

      // ===== 名前 =====
      let name = "ユーザー"
      try {
        if (event.source.groupId) {
          const p = await client.getGroupMemberProfile(gid, uid)
          name = p.displayName
        }
      } catch {}

      // ===== グループ登録 =====
      if (text === "グループ登録") {
        db.groups[gid] = {
          admins: [uid],
          subAdmins: [],
          adminNames: { [uid]: name },
          ban: [],
          banNames: {},
          reports: {},
          ngWords: []
        }
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "✅ グループ登録完了"
        })
        continue
      }

      // ===== BAN =====
      if (group.ban.includes(uid)) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚫 BANされています"
        })
        continue
      }

      // ===== BANモード =====
      if (text === "BANモード" && isManager(uid, group)) {
        banMode[gid] = true
        await client.replyMessage(event.replyToken, { type: "text", text: "次の発言者をBAN" })
        continue
      }

      if (banMode[gid] && !isManager(uid, group)) {
        group.ban.push(uid)
        group.banNames[uid] = name
        banMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, { type: "text", text: `🔨 ${name} BAN` })
        continue
      }

      // ===== 通報 =====
      if (text === "通報" && isManager(uid, group)) {
        reportMode[gid] = true
        await client.replyMessage(event.replyToken, { type: "text", text: "次の発言者を通報" })
        continue
      }

      if (reportMode[gid] && !isManager(uid, group)) {
        group.reports[uid] = (group.reports[uid] || 0) + 1
        reportMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `通報: ${name} (${group.reports[uid]}回)`
        })
        continue
      }

      // ===== 管理登録 =====
      if (text === "管理登録" && isManager(uid, group)) {
        registerMode[gid] = uid
        await client.replyMessage(event.replyToken, { type: "text", text: "次の発言者を管理者に" })
        continue
      }

      if (registerMode[gid] && uid !== registerMode[gid]) {
        group.admins.push(uid)
        group.adminNames[uid] = name
        registerMode[gid] = null
        saveDB(db)

        await client.replyMessage(event.replyToken, { type: "text", text: "管理者登録完了" })
        continue
      }

      // ===== 副管理登録 =====
      if (text === "副管理登録" && isManager(uid, group)) {
        subRegisterMode[gid] = uid
        await client.replyMessage(event.replyToken, { type: "text", text: "次の発言者を副管理に" })
        continue
      }

      if (subRegisterMode[gid] && uid !== subRegisterMode[gid]) {
        group.subAdmins.push(uid)
        group.adminNames[uid] = name
        subRegisterMode[gid] = null
        saveDB(db)

        await client.replyMessage(event.replyToken, { type: "text", text: "副管理登録完了" })
        continue
      }

      // ===== 管理削除 =====
      if (text === "管理削除" && isManager(uid, group)) {
        deleteMode[gid] = true
        await client.replyMessage(event.replyToken, { type: "text", text: "削除対象が発言してください" })
        continue
      }

      if (deleteMode[gid]) {
        group.admins = group.admins.filter(id => id !== uid)
        group.subAdmins = group.subAdmins.filter(id => id !== uid)
        deleteMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, { type: "text", text: "削除完了" })
        continue
      }

      // ===== 管理一覧 =====
      if (text === "管理一覧") {
        const list = Object.entries(group.adminNames)
          .map(([id, n]) => n)
          .join("\n") || "なし"

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `👑 管理者一覧\n${list}`
        })
        continue
      }

      // ===== 通報履歴 =====
      if (text === "通報履歴") {
        let list = Object.entries(group.reports)
          .map(([id, c]) => `${group.adminNames[id] || id}：${c}`)
          .join("\n") || "なし"

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `📊 通報履歴\n${list}`
        })
        continue
      }

      // ===== 2列メニュー =====
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

                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "button", style: "primary", color: "#1976D2", action: { type: "message", label: "管理登録", text: "管理登録" } },
                    { type: "button", style: "primary", color: "#1E88E5", action: { type: "message", label: "副管理登録", text: "副管理登録" } }
                  ]
                },

                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "button", style: "primary", color: "#42A5F5", action: { type: "message", label: "管理一覧", text: "管理一覧" } },
                    { type: "button", style: "primary", color: "#E53935", action: { type: "message", label: "BANモード", text: "BANモード" } }
                  ]
                },

                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "button", style: "primary", color: "#FB8C00", action: { type: "message", label: "通報", text: "通報" } },
                    { type: "button", style: "primary", color: "#6A1B9A", action: { type: "message", label: "通報履歴", text: "通報履歴" } }
                  ]
                },

                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "button", style: "primary", color: "#43A047", action: { type: "message", label: "管理削除", text: "管理削除" } },
                    { type: "button", style: "primary", color: "#1E88E5", action: { type: "message", label: "グループ登録", text: "グループ登録" } }
                  ]
                }

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
