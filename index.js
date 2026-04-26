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
let welcomeMode = {}

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    for (const event of req.body.events) {

      const db = loadDB()

      // ===== 新規参加 =====
      if (event.type === "memberJoined") {
        const gid = event.source.groupId
        const group = getGroup(db, gid)

        await client.pushMessage(gid, {
          type: "text",
          text: group.welcome
        })
        continue
      }

      if (event.type !== "message" || event.message.type !== "text") continue

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

      // ===== ログ =====
      function log(action) {
        group.logs.push(`${name}: ${action}`)
        if (group.logs.length > 20) group.logs.shift()
      }

      const isMgr = isManager(uid, group)

      // ===== BAN防御 =====
      if (!isMgr && group.ban.includes(uid)) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "🚫 BANされています"
        })
        continue
      }

      // ===== グループ登録 =====
      if (text === "グループ登録") {
        db.groups[gid] = {
          admins: [uid],
          subAdmins: [],
          adminNames: { [uid]: name },
          ban: [],
          banNames: {},
          reports: {},
          ngWords: [],
          welcome: "ようこそ！",
          logs: []
        }
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "グループ登録完了"
        })
        continue
      }

      // ===== 挨拶設定 =====
      if (text === "挨拶設定" && isMgr) {
        welcomeMode[gid] = true
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "新しい挨拶文を送信"
        })
        continue
      }

      if (welcomeMode[gid]) {
        group.welcome = text
        welcomeMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "挨拶更新"
        })
        continue
      }

      if (text === "挨拶確認") {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `現在の挨拶👇\n${group.welcome}`
        })
        continue
      }

      // ===== BANモード =====
      if (text === "BANモード" && isMgr) {
        banMode[gid] = true
        await client.replyMessage(event.replyToken, { type: "text", text: "次をBAN" })
        continue
      }

      if (banMode[gid] && !isMgr) {
        group.ban.push(uid)
        group.banNames[uid] = name
        log("BAN")
        banMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `${name} BAN`
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
        group.reports[uid] = (group.reports[uid] || 0) + 1
        log("通報")
        reportMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `${name} 通報 (${group.reports[uid]})`
        })
        continue
      }

      if (text === "通報履歴") {
        const list = Object.entries(group.reports)
          .map(([id, c]) => `${group.adminNames[id] || id}：${c}`)
          .join("\n") || "なし"

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: list
        })
        continue
      }

      // ===== NG追加 =====
      if (text === "NG追加" && isMgr) {
        ngAddMode[gid] = true
        await client.replyMessage(event.replyToken, { type: "text", text: "NG送信" })
        continue
      }

      if (ngAddMode[gid]) {
        group.ngWords.push(text)
        ngAddMode[gid] = false
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `NG追加:${text}`
        })
        continue
      }

      // ===== NG削除 =====
      if (text.startsWith("NG削除:")) {
        const word = text.replace("NG削除:", "")
        group.ngWords = group.ngWords.filter(w => w !== word)
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `削除:${word}`
        })
        continue
      }

      // ===== NG一覧 =====
      if (text === "NG一覧") {

        const contents = group.ngWords.map(word => ({
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: word, flex: 5 },
            {
              type: "button",
              style: "secondary",
              action: {
                type: "message",
                label: "削除",
                text: `NG削除:${word}`
              }
            }
          ]
        }))

        await client.replyMessage(event.replyToken, {
          type: "flex",
          altText: "NG一覧",
          contents: {
            type: "bubble",
            body: { type: "box", layout: "vertical", contents }
          }
        })
        continue
      }

      // ===== NG検知 =====
      if (!isMgr && group.ngWords.some(w => text.includes(w))) {
        group.ban.push(uid)
        group.banNames[uid] = name
        log("NG BAN")
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `${name} NG BAN`
        })
        continue
      }

      // ===== 管理登録 =====
      if (text === "管理登録" && isMgr) {
        registerMode[gid] = uid
        await client.replyMessage(event.replyToken, { type: "text", text: "次を管理者" })
        continue
      }

      if (registerMode[gid] && uid !== registerMode[gid]) {
        group.admins.push(uid)
        group.adminNames[uid] = name
        registerMode[gid] = null
        saveDB(db)

        await client.replyMessage(event.replyToken, { type: "text", text: "管理登録完了" })
        continue
      }

      // ===== 管理一覧 =====
      if (text === "管理一覧") {
        const list = Object.values(group.adminNames).join("\n") || "なし"
        await client.replyMessage(event.replyToken, { type: "text", text: list })
        continue
      }

      // ===== ログ =====
      if (text === "ログ") {
        const list = group.logs.join("\n") || "なし"
        await client.replyMessage(event.replyToken, { type: "text", text: list })
        continue
      }

      // ===== メニュー（2列） =====
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
                    { type: "button", action: { type: "message", label: "管理登録", text: "管理登録" } },
                    { type: "button", action: { type: "message", label: "BANモード", text: "BANモード" } }
                  ]
                },

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
                    { type: "button", action: { type: "message", label: "管理一覧", text: "管理一覧" } },
                    { type: "button", action: { type: "message", label: "挨拶設定", text: "挨拶設定" } }
                  ]
                },

                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "button", action: { type: "message", label: "挨拶確認", text: "挨拶確認" } },
                    { type: "button", action: { type: "message", label: "ログ", text: "ログ" } }
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
