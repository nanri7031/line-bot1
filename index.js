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
let banMode = {}
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

      // ===== BANモード =====
      if (text === "BANモード" && isManager(uid, group)) {
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
        group.reports[uid] = (group.reports[uid] || 0) + 1
        banMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `🔨 ${name} をBAN`
        })
        continue
      }

      // ===== NG追加 =====
      if (text === "NG追加" && isManager(uid, group)) {
        ngAddMode[gid] = true
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "追加するNGワード送信"
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
      if (text.startsWith("NG削除:")) {
        if (!isManager(uid, group)) {
          await client.replyMessage(event.replyToken, { type: "text", text: "権限なし" })
          continue
        }

        const word = text.replace("NG削除:", "")
        group.ngWords = group.ngWords.filter(w => w !== word)
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `削除: ${word}`
        })
        continue
      }

      // ===== NG一覧 =====
      if (text === "NG一覧") {

        const contents = group.ngWords.map(word => ({
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: word, flex: 5, size: "sm" },
            {
              type: "button",
              style: "secondary",
              height: "sm",
              action: {
                type: "message",
                label: "削除",
                text: `NG削除:${word}`
              }
            }
          ]
        }))

        if (contents.length === 0) {
          contents.push({ type: "text", text: "NGなし" })
        }

        await client.replyMessage(event.replyToken, {
          type: "flex",
          altText: "NG一覧",
          contents: {
            type: "bubble",
            body: {
              type: "box",
              layout: "vertical",
              spacing: "sm",
              contents
            }
          }
        })
        continue
      }

      // ===== NG検知 =====
      if (group.ngWords.some(w => text.includes(w))) {
        group.ban.push(uid)
        group.banNames[uid] = name
        group.reports[uid] = (group.reports[uid] || 0) + 1
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `⚠️ NG → BAN (${name})`
        })
        continue
      }

      // ===== 管理登録 =====
      if (text === "管理登録" && isManager(uid, group)) {
        registerMode[gid] = uid
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "次の発言者を管理者登録"
        })
        continue
      }

      if (registerMode[gid] && uid !== registerMode[gid]) {
        group.admins.push(uid)
        group.adminNames[uid] = name
        registerMode[gid] = null
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "👑 管理者登録完了"
        })
        continue
      }

      // ===== BAN一覧 =====
      if (text === "BAN一覧") {
        const list = Object.values(group.banNames).join("\n") || "なし"
        await client.replyMessage(event.replyToken, { type: "text", text: list })
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

      // ===== 通報履歴 =====
      if (text === "通報履歴") {
        let list = Object.entries(group.reports)
          .sort((a, b) => b[1] - a[1])
          .map(([id, c]) => `${group.banNames[id] || id}：${c}回`)
          .join("\n")

        if (!list) list = "なし"

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
                    { type: "button", style: "primary", color: "#E53935", action: { type: "message", label: "BANモード", text: "BANモード" } }
                  ]
                },

                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "button", style: "primary", color: "#FB8C00", action: { type: "message", label: "NG追加", text: "NG追加" } },
                    { type: "button", style: "primary", color: "#8E24AA", action: { type: "message", label: "NG一覧", text: "NG一覧" } }
                  ]
                },

                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "button", style: "primary", color: "#1E88E5", action: { type: "message", label: "BAN一覧", text: "BAN一覧" } },
                    { type: "button", style: "primary", color: "#43A047", action: { type: "message", label: "BAN解除", text: "BAN解除" } }
                  ]
                },

                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "button", style: "primary", color: "#6A1B9A", action: { type: "message", label: "通報履歴", text: "通報履歴" } }
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
