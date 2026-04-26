import express from "express"
import line from "@line/bot-sdk"
import { Low } from "lowdb"
import { JSONFile } from "lowdb/node"

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)

// ===== DB =====
const adapter = new JSONFile("db.json")
const db = new Low(adapter, {
  admins: [],
  subAdmins: [],
  banList: [],
  reports: {},
  settings: {
    autoBan: 3,
    ngWords: []
  }
})

await db.read()
db.data ||= {
  admins: [],
  subAdmins: [],
  banList: [],
  reports: {},
  settings: {
    autoBan: 3,
    ngWords: []
  }
}
await db.write()

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  await Promise.all(req.body.events.map(handleEvent))
  res.sendStatus(200)
})

// ===== メイン処理 =====
async function handleEvent(event) {
  if (event.type !== "message") return
  if (event.message.type !== "text") return

  const userId = event.source.userId
  const text = event.message.text

  await db.read()

  const isAdmin = db.data.admins.includes(userId)
  const isSub = db.data.subAdmins.includes(userId)

  // ===== 初期管理者 =====
  if (text === "管理者登録") {
    if (db.data.admins.length === 0) {
      db.data.admins.push(userId)
      await db.write()
      return reply(event, "管理者登録完了")
    }
  }

  // ===== メニュー =====
  if (text === "メニュー") {
    return replyFlex(event, isAdmin, isSub)
  }

  // ===== 設定表示 =====
  if (text === "設定" && isAdmin) {
    return reply(event,
`■設定
自動BAN: ${db.data.settings.autoBan}
NGワード: ${db.data.settings.ngWords.join(",") || "なし"}`)
  }

  // ===== 自動BAN数変更 =====
  if (text.startsWith("自動BAN=") && isAdmin) {
    const num = Number(text.split("=")[1])
    db.data.settings.autoBan = num
    await db.write()
    return reply(event, "変更完了")
  }

  // ===== NGワード追加 =====
  if (text.startsWith("NG追加 ") && isAdmin) {
    const word = text.replace("NG追加 ", "")
    db.data.settings.ngWords.push(word)
    await db.write()
    return reply(event, "追加完了")
  }

  // ===== NGワード削除 =====
  if (text.startsWith("NG削除 ") && isAdmin) {
    const word = text.replace("NG削除 ", "")
    db.data.settings.ngWords =
      db.data.settings.ngWords.filter(w => w !== word)
    await db.write()
    return reply(event, "削除完了")
  }

  // ===== 副管理追加 =====
  if (text.startsWith("副管理追加") && isAdmin) {
    const target = getMention(event)
    if (!target) return reply(event, "メンションして下さい")

    db.data.subAdmins.push(target)
    await db.write()
    return reply(event, "副管理追加完了")
  }

  // ===== 副管理削除 =====
  if (text.startsWith("副管理削除") && isAdmin) {
    const target = getMention(event)
    db.data.subAdmins =
      db.data.subAdmins.filter(id => id !== target)
    await db.write()
    return reply(event, "削除完了")
  }

  // ===== BAN =====
  if (text.startsWith("BAN") && (isAdmin || isSub)) {
    const target = getMention(event)
    if (!target) return reply(event, "メンションして下さい")

    db.data.banList.push(target)
    await db.write()

    if (event.source.type === "group") {
      try {
        await client.kickoutFromGroup(event.source.groupId, target)
      } catch {}
    }

    return reply(event, "BAN完了")
  }

  // ===== 通報 =====
  if (text.startsWith("通報")) {
    const target = getMention(event)
    if (!target) return reply(event, "メンションして下さい")

    db.data.reports[target] =
      (db.data.reports[target] || 0) + 1

    if (db.data.reports[target] >= db.data.settings.autoBan) {
      db.data.banList.push(target)

      if (event.source.type === "group") {
        try {
          await client.kickoutFromGroup(event.source.groupId, target)
        } catch {}
      }

      await db.write()
      return reply(event, "自動BANしました")
    }

    await db.write()
    return reply(event, `通報数: ${db.data.reports[target]}`)
  }

  // ===== 通報確認 =====
  if (text.startsWith("通報確認") && isAdmin) {
    return reply(event, JSON.stringify(db.data.reports, null, 2))
  }

  // ===== NGワード検出 =====
  for (const ng of db.data.settings.ngWords) {
    if (text.includes(ng)) {
      if (event.source.type === "group") {
        try {
          await client.kickoutFromGroup(event.source.groupId, userId)
        } catch {}
      }
      return reply(event, "NGワード検出")
    }
  }

  return reply(event, "BOT起動中")
}

// ===== メンション取得 =====
function getMention(event) {
  return event.message.mention?.mentionees?.[0]?.userId
}

// ===== テキスト返信 =====
function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: "text",
    text
  })
}

// ===== Flexメニュー =====
function replyFlex(event, isAdmin, isSub) {
  let buttons = []

  if (isAdmin) {
    buttons = [
      btn("設定", "設定"),
      btn("BAN", "BAN @ユーザー"),
      btn("副管理追加", "副管理追加 @ユーザー"),
      btn("通報", "通報 @ユーザー")
    ]
  } else if (isSub) {
    buttons = [
      btn("BAN", "BAN @ユーザー"),
      btn("通報", "通報 @ユーザー")
    ]
  } else {
    buttons = [
      btn("通報", "通報 @ユーザー")
    ]
  }

  return client.replyMessage(event.replyToken, {
    type: "flex",
    altText: "メニュー",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "管理パネル", size: "lg", weight: "bold" }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: buttons
      }
    }
  })
}

function btn(label, text) {
  return {
    type: "button",
    style: "primary",
    action: {
      type: "message",
      label,
      text
    }
  }
}

app.listen(3000, () => console.log("Server running"))
