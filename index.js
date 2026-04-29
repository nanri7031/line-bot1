import express from "express"
import * as line from "@line/bot-sdk"
import fs from "fs"

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)

// 最初のオーナー（自分のUserIdにしてOK）
const OWNER_ID = "U1a1aca9e44466f8cb05003d7dc86fee0"

// ===== DB =====
const loadDB = () => {
  try { return JSON.parse(fs.readFileSync("db.json")) }
  catch { return { groups: {} } }
}

const saveDB = (db) => {
  fs.writeFileSync("db.json", JSON.stringify(db, null, 2))
}

const initGroup = (db, gid) => {
  if (!db.groups[gid]) {
    db.groups[gid] = {
      admins: [OWNER_ID],
      subAdmins: [],
      bans: {},          // { userId: count | 999 }
      ngWords: [],
      reports: [],       // {target, name, time}
      logs: [],          // {user, text, time}
      users: {},         // cache: { userId: displayName }
      greeting: ""
    }
  }
}

const isAdmin = (g, uid) =>
  g.admins.includes(uid) || g.subAdmins.includes(uid)

const txt = (t) => ({ type: "text", text: t })

// ===== 名前取得（キャッシュ）=====
const getName = async (gid, uid, g) => {
  if (g.users[uid]) return g.users[uid]
  try {
    const p = await client.getGroupMemberProfile(gid, uid)
    g.users[uid] = p.displayName
    return p.displayName
  } catch {
    return uid
  }
}

// ===== UI（青系2列）=====
const btn = (t, color = "#1976D2") => ({
  type: "button",
  style: "primary",
  color,
  action: { type: "message", label: t, text: t }
})

const row = (a, b) => ({
  type: "box",
  layout: "horizontal",
  spacing: "sm",
  contents: [a, b]
})

const menu = () => ({
  type: "flex",
  altText: "管理メニュー",
  contents: {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: "管理メニュー", weight: "bold", size: "lg", color: "#1565C0" },

        row(btn("管理登録"), btn("副管理登録")),
        row(btn("管理解除"), btn("副管理解除")),
        row(btn("管理一覧"), btn("BAN一覧")),

        row(btn("NG管理", "#0288D1"), btn("NG追加モード", "#0288D1")),

        row(btn("通報", "#039BE5"), btn("通報ログ", "#039BE5")),
        row(btn("通報ランキング", "#039BE5"), btn("ログ", "#1E88E5")),

        row(btn("キックモード", "#1A237E"), btn("キック", "#1A237E")),

        row(btn("挨拶設定モード", "#0097A7"), btn("挨拶確認", "#0097A7"))
      ]
    }
  }
})

// ===== BANボタン（名前クリック）=====
const banButton = (name, id) => ({
  type: "button",
  style: "secondary",
  action: { type: "message", label: `BAN ${name}`, text: `BAN:${id}` }
})

// ===== MAIN =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const db = loadDB()

    for (const event of req.body.events) {

      // ===== 参加挨拶 =====
      if (event.type === "memberJoined") {
        const gid = event.source.groupId
        initGroup(db, gid)
        const g = db.groups[gid]

        if (g.greeting) {
          await client.pushMessage(gid, txt(g.greeting))
        }
        continue
      }

      if (event.type !== "message") continue
      if (event.message.type !== "text") continue

      const gid = event.source.groupId || event.source.userId
      const uid = event.source.userId

      initGroup(db, gid)
      const g = db.groups[gid]

      const msg = event.message.text
      const mentions = event.message.mention?.mentionees || []
      const name = await getName(gid, uid, g)

      // ===== ログ =====
      g.logs.push({ user: name, text: msg, time: Date.now() })
      if (g.logs.length > 50) g.logs.shift()

      // ===== BAN制限 =====
      if (g.bans[uid] >= 3) {
        return await client.replyMessage(event.replyToken, txt("⚠️ 利用制限中"))
      }

      // ===== NG検知 =====
      if (!isAdmin(g, uid) && g.ngWords.some(w => msg.includes(w))) {
        g.bans[uid] = (g.bans[uid] || 0) + 1
        g.reports.push({ target: uid, name, time: Date.now() })
        saveDB(db)

        return await client.replyMessage(
          event.replyToken,
          txt(`⚠️ ${name} NG検知（${g.bans[uid]}回）`)
        )
      }

      let reply = null

      // ===== メニュー =====
      if (msg === "メニュー") reply = menu()

      // ===== 管理追加 =====
      else if (msg === "管理登録") {
        if (!g.admins.includes(uid)) { g.admins.push(uid); saveDB(db) }
        reply = txt("管理登録OK")
      }

      else if (msg === "副管理登録") {
        if (!g.subAdmins.includes(uid)) { g.subAdmins.push(uid); saveDB(db) }
        reply = txt("副管理登録OK")
      }

      // ===== 管理解除（自分 or メンション）=====
      else if (msg === "管理解除") {
        if (mentions.length > 0) {
          const target = mentions[0].userId
          g.admins = g.admins.filter(id => id !== target)
        } else {
          g.admins = g.admins.filter(id => id !== uid)
        }
        saveDB(db)
        reply = txt("管理解除OK")
      }

      else if (msg === "副管理解除") {
        if (mentions.length > 0) {
          const target = mentions[0].userId
          g.subAdmins = g.subAdmins.filter(id => id !== target)
        } else {
          g.subAdmins = g.subAdmins.filter(id => id !== uid)
        }
        saveDB(db)
        reply = txt("副管理解除OK")
      }

      else if (msg === "管理一覧") {
        reply = txt([...g.admins, ...g.subAdmins].join("\n") || "なし")
      }

      // ===== NG =====
      else if (msg === "NG追加モード") reply = txt("NG追加:ワード")

      else if (msg.startsWith("NG追加:")) {
        g.ngWords.push(msg.replace("NG追加:", ""))
        saveDB(db)
        reply = txt("追加OK")
      }

      else if (msg === "NG管理") {
        reply = txt(g.ngWords.join("\n") || "なし")
      }

      // ===== 通報 =====
      else if (msg === "通報" && mentions.length > 0) {
        const target = mentions[0].userId
        const tName = await getName(gid, target, g)

        g.reports.push({ target, name: tName, time: Date.now() })
        g.bans[target] = (g.bans[target] || 0) + 1
        saveDB(db)

        reply = txt(`通報: ${tName}`)
      }

      else if (msg === "通報") reply = txt("メンションして通報")

      else if (msg === "通報ログ") {
        reply = txt(g.reports.map(r => r.name).join("\n") || "なし")
      }

      else if (msg === "通報ランキング") {
        const count = {}
        g.reports.forEach(r => count[r.name] = (count[r.name] || 0) + 1)
        const rank = Object.entries(count)
          .sort((a, b) => b[1] - a[1])
          .map(([n, c]) => `${n}:${c}`)
          .join("\n")
        reply = txt(rank || "なし")
      }

      // ===== BAN =====
      else if (msg === "BAN一覧") {
        const contents = Object.entries(g.users).map(([id, n]) => banButton(n, id))
        reply = {
          type: "flex",
          altText: "BAN",
          contents: {
            type: "bubble",
            body: { type: "box", layout: "vertical", contents: contents }
          }
        }
      }

      else if (msg.startsWith("BAN:")) {
        const id = msg.replace("BAN:", "")
        g.bans[id] = 999
        saveDB(db)
        reply = txt("BAN実行")
      }

      else if (msg.startsWith("BAN解除:")) {
        const id = msg.replace("BAN解除:", "")
        delete g.bans[id]
        saveDB(db)
        reply = txt("BAN解除OK")
      }

      // ===== キック =====
      else if (msg === "キックモード") reply = txt("メンションしてキック")

      else if (msg === "キック" && mentions.length > 0) {
        const target = mentions[0].userId
        const tName = await getName(gid, target, g)
        g.bans[target] = 999
        saveDB(db)
        reply = txt(`⚠️ ${tName} キック`)
      }

      // ===== ログ =====
      else if (msg === "ログ") {
        reply = txt(g.logs.map(l => `${l.user}:${l.text}`).join("\n") || "なし")
      }

      // ===== 挨拶 =====
      else if (msg === "挨拶設定モード") reply = txt("挨拶設定:内容")

      else if (msg.startsWith("挨拶設定:")) {
        g.greeting = msg.replace("挨拶設定:", "")
        saveDB(db)
        reply = txt("設定OK")
      }

      else if (msg === "挨拶確認") {
        reply = txt(g.greeting || "未設定")
      }

      // ===== みくちゃん =====
      else if (msg.startsWith("みくちゃん")) {
        const t = msg.replace("みくちゃん", "").trim()
        const pick = a => a[Math.floor(Math.random() * a.length)]

        if (t.includes("おは")) reply = txt(pick(["おはよう☀️", "今日も頑張ろ😊"]))
        else if (t.includes("ありが")) reply = txt(pick(["どういたしまして😊"]))
        else if (t.includes("おつ")) reply = txt(pick(["お疲れ様✨"]))
      }

      if (reply) {
        await client.replyMessage(event.replyToken, reply)
      }
    }

    saveDB(db)
    res.sendStatus(200)

  } catch (e) {
    console.log(e)
    res.sendStatus(200)
  }
})

app.listen(process.env.PORT || 3000)
