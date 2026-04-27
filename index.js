import express from "express"
import line from "@line/bot-sdk"
import fs from "fs"

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)

const OWNER_ID = "U1a1aca9e44466f8cb05003d7dc86fee0"

// DB
const loadDB = () => JSON.parse(fs.readFileSync("db.json"))
const saveDB = (db) => fs.writeFileSync("db.json", JSON.stringify(db, null, 2))

const initGroup = (db, gid) => {
  if (!db.groups[gid]) {
    db.groups[gid] = {
      admins: [OWNER_ID],
      subAdmins: [],
      bans: [],
      ngWords: [],
      reports: {},
      greeting: "",
      users: {}
    }
  }
}

const isAdmin = (g, uid) =>
  g.admins.includes(uid) || g.subAdmins.includes(uid)

// 名前取得
async function getName(userId) {
  try {
    const p = await client.getProfile(userId)
    return p.displayName
  } catch {
    return "unknown"
  }
}

// 🔥 メニュー
function mainMenu() {
  return {
    type: "flex",
    altText: "管理メニュー",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: "管理メニュー", weight: "bold", size: "lg" },

          btn("管理一覧", "管理一覧"),
          btn("BAN管理", "BAN管理"),
          btn("NG管理", "NG管理"),
          btn("通報パネル", "通報パネル"),
          btn("挨拶設定", "挨拶設定"),
          btn("ログ", "ログ")
        ]
      }
    }
  }
}

function btn(label, text) {
  return {
    type: "button",
    style: "primary",
    action: { type: "message", label, text }
  }
}

// 🔥 BAN UI
function banUI(g) {
  const list = Object.entries(g.users).slice(0, 10)

  return {
    type: "flex",
    altText: "BAN管理",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: list.map(([id, name]) => ({
          type: "button",
          action: {
            type: "message",
            label: `${name}`,
            text: `BAN:${id}`
          }
        }))
      }
    }
  }
}

// 🔥 NG UI
function ngUI(g) {
  return {
    type: "flex",
    altText: "NG",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: g.ngWords.map(w => ({
          type: "button",
          action: {
            type: "message",
            label: `${w} 削除`,
            text: `NGDEL:${w}`
          }
        }))
      }
    }
  }
}

// 🔥 通報UI
function reportUI(g) {
  const arr = Object.entries(g.reports)

  return {
    type: "flex",
    altText: "通報",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: arr.map(([uid, count]) => ({
          type: "button",
          action: {
            type: "message",
            label: `${g.users[uid] || uid} ×${count}`,
            text: `BAN:${uid}`
          }
        }))
      }
    }
  }
}

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const db = loadDB()

    for (const event of req.body.events) {

      if (!event.source.groupId) continue

      const gid = event.source.groupId
      const uid = event.source.userId

      initGroup(db, gid)
      const g = db.groups[gid]

      if (!g.users[uid]) {
        g.users[uid] = await getName(uid)
        saveDB(db)
      }

      if (event.type === "memberJoined") {
        if (g.greeting) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: g.greeting
          })
        }
      }

      if (event.type !== "message") continue

      const msg = event.message.text

      // BAN制御
      if (g.bans.includes(uid)) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "⚠️ 制限中"
        })
        return
      }

      // NG検知
      for (const ng of g.ngWords) {
        if (msg.includes(ng)) {
          g.reports[uid] = (g.reports[uid] || 0) + 1
          saveDB(db)

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "⚠️ NGワード"
          })
          return
        }
      }

      // ===== GUI操作 =====

      if (msg === "メニュー") {
        await client.replyMessage(event.replyToken, mainMenu())
      }

      else if (msg === "BAN管理") {
        await client.replyMessage(event.replyToken, banUI(g))
      }

      else if (msg.startsWith("BAN:")) {
        if (!isAdmin(g, uid)) return

        const target = msg.replace("BAN:", "")
        if (!g.bans.includes(target)) {
          g.bans.push(target)
        }
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "BAN完了"
        })
      }

      else if (msg === "NG管理") {
        await client.replyMessage(event.replyToken, ngUI(g))
      }

      else if (msg.startsWith("NGDEL:")) {
        const word = msg.replace("NGDEL:", "")
        g.ngWords = g.ngWords.filter(w => w !== word)
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "削除完了"
        })
      }

      else if (msg === "通報パネル") {
        await client.replyMessage(event.replyToken, reportUI(g))
      }

      else if (msg === "通報") {
        g.reports[uid] = (g.reports[uid] || 0) + 1
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "通報済"
        })
      }

      else if (msg === "管理一覧") {
        const txt = [...g.admins, ...g.subAdmins]
          .map(id => g.users[id] || id)
          .join("\n")

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: txt || "なし"
        })
      }

      else if (msg.startsWith("挨拶設定 ")) {
        g.greeting = msg.replace("挨拶設定 ", "")
        saveDB(db)

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "設定OK"
        })
      }

      else {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "OK"
        })
      }
    }

    res.sendStatus(200)
  } catch (e) {
    console.log(e)
    res.sendStatus(500)
  }
})

app.listen(process.env.PORT || 3000)
