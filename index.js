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
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ groups: {} }, null, 2))
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
      reports: {},
      ngWords: [],
      welcome: "ようこそ！",
      logs: []
    }
  }
  if (!db.groups[gid].admins.includes(OWNER_ID)) {
    db.groups[gid].admins.push(OWNER_ID)
  }
  return db.groups[gid]
}

function isManager(uid, g) {
  return g.admins.includes(uid) || g.subAdmins.includes(uid)
}

// 状態
let ngMode = {}
let welcomeMode = {}
let reportMode = {}

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    for (const event of req.body.events) {

      const db = loadDB()

      // ===== 新規参加 =====
      if (event.type === "memberJoined") {
        const gid = event.source.groupId
        const g = getGroup(db, gid)

        await client.pushMessage(gid, {
          type: "text",
          text: g.welcome
        })
        continue
      }

      if (event.type !== "message" || event.message.type !== "text") continue

      const text = event.message.text.trim()
      const uid = event.source.userId
      const gid = event.source.groupId || uid

      const g = getGroup(db, gid)

      let name = "ユーザー"
      try {
        if (gid !== uid) {
          const p = await client.getGroupMemberProfile(gid, uid)
          name = p.displayName
        }
      } catch {}

      const isMgr = isManager(uid, g)

      // ===== BAN防御 =====
      if (!isMgr && g.ban.includes(uid)) {
        await client.replyMessage(event.replyToken, { type: "text", text: "🚫 BANされています" })
        continue
      }

      // ===== メンションBAN =====
      if (text.includes("BAN") && event.message.mention?.mentionees && isMgr) {
        const target = event.message.mention.mentionees[0].userId

        if (isManager(target, g)) {
          await client.replyMessage(event.replyToken, { type: "text", text: "管理者対象外" })
          continue
        }

        g.ban.push(target)
        saveDB(db)

        await client.replyMessage(event.replyToken, { type: "text", text: "BAN完了" })
        continue
      }

      // ===== メンションキック =====
      if (text.includes("キック") && event.message.mention?.mentionees && isMgr) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "⚠️ 対象ユーザーは退出してください"
        })
        continue
      }

      // ===== 通報 =====
      if (text === "通報" && isMgr) {
        reportMode[gid] = true
        await client.replyMessage(event.replyToken, { type: "text", text: "次を通報" })
        continue
      }

      if (reportMode[gid] && !isMgr) {
        g.reports[uid] = (g.reports[uid] || 0) + 1
        reportMode[gid] = false

        if (g.reports[uid] === 2) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `⚠️ ${name} 退出推奨`
          })
        }

        if (g.reports[uid] >= 3) {
          g.ban.push(uid)
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `🚫 ${name} BAN`
          })
        }

        saveDB(db)
        continue
      }

      // ===== NG追加 =====
      if (text === "NG追加" && isMgr) {
        ngMode[gid] = true
        await client.replyMessage(event.replyToken, { type: "text", text: "NG送信" })
        continue
      }

      if (ngMode[gid]) {
        g.ngWords.push(text)
        ngMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, { type: "text", text: "追加完了" })
        continue
      }

      // ===== NG検知 =====
      if (!isMgr && g.ngWords.some(w => text.includes(w))) {
        g.ban.push(uid)
        saveDB(db)

        await client.replyMessage(event.replyToken, { type: "text", text: "NG BAN" })
        continue
      }

      // ===== 挨拶 =====
      if (text === "挨拶設定" && isMgr) {
        welcomeMode[gid] = true
        await client.replyMessage(event.replyToken, { type: "text", text: "挨拶送信" })
        continue
      }

      if (welcomeMode[gid]) {
        g.welcome = text
        welcomeMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, { type: "text", text: "更新完了" })
        continue
      }

      if (text === "挨拶確認") {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: g.welcome
        })
        continue
      }

      // ===== メニュー =====
      if (text === "メニュー") {
        await client.replyMessage(event.replyToken, {
          type: "flex",
          altText: "管理メニュー",
          contents: {
            type: "bubble",
            header: {
              type: "box",
              layout: "vertical",
              contents: [
                { type: "text", text: "🛠 管理メニュー", color: "#fff", align: "center" }
              ],
              backgroundColor: "#1565C0"
            },
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              contents: [

                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "button", action: { type: "message", label: "NG追加", text: "NG追加" } },
                    { type: "button", action: { type: "message", label: "通報", text: "通報" } }
                  ]
                },

                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "button", action: { type: "message", label: "挨拶設定", text: "挨拶設定" } },
                    { type: "button", action: { type: "message", label: "挨拶確認", text: "挨拶確認" } }
                  ]
                }

              ]
            }
          }
        })
        continue
      }

      await client.replyMessage(event.replyToken, {
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
