import express from "express"
import line from "@line/bot-sdk"
import fs from "fs"

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)

// ===== DB =====
let db = {}
try {
  db = JSON.parse(fs.readFileSync("./db.json", "utf-8"))
} catch { db = {} }

db.admins ||= []
db.subAdmins ||= []
db.reports ||= {}
db.blacklist ||= []
db.settings ||= {
  autoBan: 3,
  ngWords: [],
  emergency: false
}

const save = () =>
  fs.writeFileSync("./db.json", JSON.stringify(db, null, 2))

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  await Promise.all(req.body.events.map(handleEvent))
  res.sendStatus(200)
})

app.get("/", (req, res) => res.send("RUNNING"))

// ===== メイン =====
async function handleEvent(event) {

  // ===== 参加時ブラックリストキック =====
  if (event.type === "memberJoined") {
    for (const m of event.joined.members) {
      if (db.blacklist.includes(m.userId)) {
        await client.kickoutFromGroup(event.source.groupId, m.userId)
      }
    }
    return
  }

  if (event.type !== "message" || event.message.type !== "text") return

  const text = event.message.text
  const userId = event.source.userId
  const groupId = event.source.groupId

  const isAdmin = db.admins.includes(userId)
  const isSub = db.subAdmins.includes(userId)

  // ===== 初期管理者 =====
  if (text === "管理者登録" && db.admins.length === 0) {
    db.admins.push(userId)
    save()
    return reply(event, "👑 管理人登録")
  }

  // ===== 緊急モード =====
  if (isAdmin && text === "緊急ON") {
    db.settings.emergency = true
    save()
    return reply(event, "🚨 ON")
  }

  if (isAdmin && text === "緊急OFF") {
    db.settings.emergency = false
    save()
    return reply(event, "OFF")
  }

  if (db.settings.emergency && !(isAdmin || isSub)) {
    await kick(groupId, userId)
    return
  }

  // ===== メニューUI =====
  if (text === "メニュー") {
    return client.replyMessage(event.replyToken, menuUI(isAdmin, isSub))
  }

  // ===== 副管理 =====
  if (isAdmin && text.startsWith("副管理追加")) {
    const t = getMention(event)
    db.subAdmins.push(t)
    save()
    return reply(event, "追加OK")
  }

  if (isAdmin && text.startsWith("副管理削除")) {
    const t = getMention(event)
    db.subAdmins = db.subAdmins.filter(id => id !== t)
    save()
    return reply(event, "削除OK")
  }

  // ===== NG =====
  if ((isAdmin || isSub) && text.startsWith("NG追加 ")) {
    db.settings.ngWords.push(text.replace("NG追加 ", ""))
    save()
    return reply(event, "追加OK")
  }

  if (isAdmin && text.startsWith("NG削除 ")) {
    db.settings.ngWords =
      db.settings.ngWords.filter(w => w !== text.replace("NG削除 ", ""))
    save()
    return reply(event, "削除OK")
  }

  // ===== BAN =====
  if ((isAdmin || isSub) && text.startsWith("BAN")) {
    const t = getMention(event)
    db.blacklist.push(t)
    save()
    await kick(groupId, t)
    return reply(event, "🚫 BAN")
  }

  // ===== 通報 =====
  if (text.startsWith("通報")) {
    const t = getMention(event)
    db.reports[t] = (db.reports[t] || 0) + 1

    // 管理者通知
    for (const a of db.admins) {
      await client.pushMessage(a, {
        type: "text",
        text: `🚨通報\n${t}\n回数:${db.reports[t]}`
      })
    }

    if (db.reports[t] >= db.settings.autoBan) {
      db.blacklist.push(t)
      await kick(groupId, t)
      db.reports[t] = 0
      save()
      return reply(event, "🚫 自動BAN")
    }

    save()
    return reply(event, `通報 ${db.reports[t]}`)
  }

  // ===== NG検知 =====
  if (db.settings.ngWords.some(w => text.includes(w))) {
    db.blacklist.push(userId)
    await kick(groupId, userId)
    save()
    return
  }
}

// ===== UI =====
function menuUI(isAdmin, isSub) {
  return {
    type: "flex",
    altText: "メニュー",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "管理パネル", weight: "bold" }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          btn("通報", "通報 @ユーザー"),
          ...(isAdmin || isSub ? [btn("BAN", "BAN @ユーザー")] : []),
          ...(isAdmin ? [btn("緊急ON", "緊急ON"), btn("緊急OFF", "緊急OFF")] : [])
        ]
      }
    }
  }
}

function btn(label, text) {
  return {
    type: "button",
    action: { type: "message", label, text }
  }
}

// ===== 共通 =====
function getMention(e) {
  return e.message.mention?.mentionees?.[0]?.userId
}

async function kick(g, u) {
  try { await client.kickoutFromGroup(g, u) } catch {}
}

function reply(event, text) {
  return client.replyMessage(event.replyToken, { type: "text", text })
}

app.listen(process.env.PORT || 3000)
