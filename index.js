import express from "express"
import line from "@line/bot-sdk"
import dotenv from "dotenv"
import { Low } from "lowdb"
import { JSONFile } from "lowdb/node"

dotenv.config()
const app = express()

// =====================
// LINE設定
// =====================
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}
const client = new line.Client(config)

// =====================
// DB
// =====================
const adapter = new JSONFile("db.json")

const defaultData = {
  admins: ["U1a1aca9e44466f8cb05003d7dc86fee0"],
  subAdmins: [],
  banList: [],
  reports: {},
  userCounts: {},
  emergency: false,
  logs: [],
  groups: {}, // ← グループ別設定
  settings: {
    autoBan: 3,
    ngWords: ["死ね", "荒らし"]
  }
}

const db = new Low(adapter, defaultData)
await db.read()
await db.write()

// =====================
// Webhook
// =====================
app.post("/webhook", line.middleware(config), async (req, res) => {
  await Promise.all(req.body.events.map(handleEvent))
  res.sendStatus(200)
})

// =====================
// 管理画面
// =====================
app.get("/", async (req, res) => {
  await db.read()

  res.send(`
    <h1>BOT管理</h1>
    <p>緊急: ${db.data.emergency}</p>

    <h2>グループ設定</h2>
    <pre>${JSON.stringify(db.data.groups, null, 2)}</pre>

    <h2>NG</h2>
    <pre>${db.data.settings.ngWords.join(", ")}</pre>
  `)
})

// =====================
// UIメニュー
// =====================
function menuFlex() {
  return {
    type: "flex",
    altText: "管理メニュー",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "管理パネル", weight: "bold", size: "xl" },
          btn("通報"),
          btn("設定"),
          btn("緊急オン"),
          btn("緊急オフ")
        ]
      }
    }
  }
}

function btn(label) {
  return {
    type: "button",
    action: {
      type: "message",
      label: label,
      text: label
    }
  }
}

// =====================
// メイン処理
// =====================
async function handleEvent(event) {

  await db.read()

  const groupId = event.source.groupId
  const userId = event.source.userId

  // =====================
  // 👤 ユーザー名取得
  // =====================
  let userName = "Unknown"
  try {
    if (groupId) {
      const profile = await client.getGroupMemberProfile(groupId, userId)
      userName = profile.displayName
    } else {
      const profile = await client.getProfile(userId)
      userName = profile.displayName
    }
  } catch (e) {}

  // =====================
  // 👣 参加・退出
  // =====================
  if (event.type === "memberJoined") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `👣 ${userName} が参加`
    })
  }

  if (event.type === "memberLeft") {
    return
  }

  if (event.type !== "message") return
  if (event.message.type !== "text") return

  const text = event.message.text

  // =====================
  // 📂 グループ設定初期化
  // =====================
  if (groupId && !db.data.groups[groupId]) {
    db.data.groups[groupId] = {
      ngWords: [...db.data.settings.ngWords],
      autoBan: db.data.settings.autoBan
    }
    await db.write()
  }

  const groupSetting = groupId
    ? db.data.groups[groupId]
    : db.data.settings

  const { ngWords, autoBan } = groupSetting

  const { admins, subAdmins, banList, userCounts, emergency } = db.data

  const isAdmin = admins.includes(userId)
  const isSubAdmin = subAdmins.includes(userId)

  // BAN
  if (banList.includes(userId)) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "🚫 BAN済み"
    })
  }

  // 緊急
  if (emergency && !isAdmin && !isSubAdmin) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "🚨 緊急モード中"
    })
  }

  // =====================
  // 🔥 NG検知
  // =====================
  const isNG = ngWords.some(w => text.includes(w))

  if (isNG && !isAdmin && !isSubAdmin) {

    userCounts[userId] = (userCounts[userId] || 0) + 1

    if (userCounts[userId] >= autoBan) {
      banList.push(userId)
      await db.write()

      for (const id of admins) {
        await client.pushMessage(id, {
          type: "text",
          text: `🚫 BAN\n${userName} (${userId})`
        })
      }

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: `🚫 ${userName} をBAN`
      })
    }

    await db.write()

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `⚠️ ${userName} NG (${userCounts[userId]}/${autoBan})`
    })
  }

  // =====================
  // UI
  // =====================
  if (text === "メニュー") {
    return client.replyMessage(event.replyToken, menuFlex())
  }

  if (text === "設定") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `NG: ${ngWords.join(",")}\n回数:${autoBan}`
    })
  }

  if (text === "緊急オン" && isAdmin) {
    db.data.emergency = true
    await db.write()
    return client.replyMessage(event.replyToken, { type: "text", text: "ON" })
  }

  if (text === "緊急オフ" && isAdmin) {
    db.data.emergency = false
    await db.write()
    return client.replyMessage(event.replyToken, { type: "text", text: "OFF" })
  }

  // =====================
  // グループ別 NG追加
  // =====================
  if (text.startsWith("NG追加") && isAdmin) {
    const word = text.replace("NG追加", "").trim()

    if (groupId) {
      db.data.groups[groupId].ngWords.push(word)
    } else {
      db.data.settings.ngWords.push(word)
    }

    await db.write()

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `追加: ${word}`
    })
  }

  // 通報
  if (text === "通報") {
    db.data.reports[userId] = (db.data.reports[userId] || 0) + 1
    await db.write()

    for (const id of admins) {
      await client.pushMessage(id, {
        type: "text",
        text: `📩 通報\n${userName}`
      })
    }

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "通報しました"
    })
  }

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "コマンド不明"
  })
}

app.listen(process.env.PORT || 3000)
