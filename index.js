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

// ===== DB =====
const loadDB = () => JSON.parse(fs.readFileSync("db.json"))
const saveDB = (db) => fs.writeFileSync("db.json", JSON.stringify(db, null, 2))

const initGroup = (db, gid) => {
  if (!db.groups[gid]) {
    db.groups[gid] = {
      admins: [OWNER_ID],
      subAdmins: [],
      bans: [],
      ngWords: [],
      reports: [],
      reportCount: {},
      greeting: "",
      users: {}
    }
  }
}

const isAdmin = (g, uid) =>
  g.admins.includes(uid) || g.subAdmins.includes(uid)

// ===== 名前取得 =====
async function getName(userId) {
  try {
    const p = await client.getProfile(userId)
    return p.displayName
  } catch {
    return "unknown"
  }
}

// ===== 管理者通知 =====
async function notifyAdmins(g, text) {
  for (const id of g.admins) {
    try {
      await client.pushMessage(id, { type: "text", text })
    } catch {}
  }
}

// ===== メニュー =====
function menu() {
  return {
    type: "flex",
    altText: "管理",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [

          title("管理メニュー"),

          row(btn("👑管理","管理登録"), btn("👥副管理","副管理登録")),
          row(btn("📋一覧","管理一覧"), btn("❌削除","管理削除")),

          row(btn("🔨BAN","BANモード","#e53935"), btn("📄一覧","BAN一覧","#e53935")),
          row(btn("🚫NG","NG管理","#ff9800"), btn("➕追加","NG追加モード","#ff9800")),

          row(btn("🚨通報","通報"), btn("📊ログ","通報ログ")),

          row(btn("📝挨拶","挨拶設定モード","#2196f3"), btn("👀確認","挨拶確認","#2196f3")),

          row(btn("⚠警告","キックモード","#9c27b0"), btn("📜履歴","ログ","#607d8b")),

          row(btn("⚙情報","グループ情報","#607d8b"), btn("🧹リセット","リセット","#000"))
        ]
      }
    }
  }
}

const btn = (label, text, color="#4CAF50") => ({
  type:"button", style:"primary", color,
  action:{type:"message",label,text}
})

const row = (a,b)=>({
  type:"box", layout:"horizontal", spacing:"sm",
  contents:[
    {type:"box",layout:"vertical",contents:[a],flex:1},
    {type:"box",layout:"vertical",contents:[b],flex:1}
  ]
})

const title = t => ({type:"text",text:t,weight:"bold",size:"lg"})

// ===== メイン =====
app.post("/webhook", line.middleware(config), async (req,res)=>{
  try{
    const db = loadDB()

    for(const event of req.body.events){

      if(!event.source) continue

      const gid = event.source.groupId || event.source.userId
      const uid = event.source.userId

      initGroup(db,gid)
      const g = db.groups[gid]

      // ユーザー登録
      if(uid && !g.users[uid]){
        g.users[uid] = await getName(uid)
        saveDB(db)
      }

      // 挨拶
      if(event.type==="memberJoined" && g.greeting){
        await client.replyMessage(event.replyToken,{type:"text",text:g.greeting})
      }

      if(event.type!=="message") continue
      const msg = event.message.text

      // ===== BAN制御 =====
      if(g.bans.includes(uid)){
        return reply("⚠ 制限中")
      }

      // ===== NG検知＋自動BAN =====
      for(const ng of g.ngWords){
        if(msg.includes(ng)){
          g.reportCount[uid]=(g.reportCount[uid]||0)+1

          if(g.reportCount[uid]>=3){
            g.bans.push(uid)
            notifyAdmins(g, `🚨自動BAN: ${g.users[uid]}`)
          }

          saveDB(db)
          return reply("⚠ NG検出")
        }
      }

      // ===== GUI =====
      if(msg==="メニュー"){
        return client.replyMessage(event.replyToken, menu())
      }

      // 管理
      if(msg==="管理登録"){
        if(!g.admins.includes(uid)){
          g.admins.push(uid)
          saveDB(db)
        }
        return reply("管理登録OK")
      }

      if(msg==="副管理登録"){
        g.subAdmins.push(uid)
        saveDB(db)
        return reply("副管理OK")
      }

      if(msg==="管理一覧"){
        return reply([...g.admins,...g.subAdmins].map(i=>g.users[i]).join("\n"))
      }

      if(msg==="管理削除"){
        g.admins=g.admins.filter(i=>i!==uid)
        saveDB(db)
        return reply("削除OK")
      }

      // ===== メンションBAN =====
      if(msg.startsWith("@")){
        if(!isAdmin(g,uid)) return

        const targetName = msg.replace("@","")
        const targetId = Object.keys(g.users)
          .find(id => g.users[id] === targetName)

        if(targetId){
          g.bans.push(targetId)
          saveDB(db)

          notifyAdmins(g, `🔨BAN: ${targetName}`)

          return reply("BAN完了")
        }
      }

      // ===== 通報 =====
      if(msg==="通報"){
        g.reports.push({
          from: uid,
          name: g.users[uid],
          time: Date.now()
        })

        notifyAdmins(g, `🚨通報: ${g.users[uid]}`)

        saveDB(db)
        return reply("通報完了")
      }

      if(msg==="通報ログ"){
        const log = g.reports.slice(-5)
          .map(r=>r.name)
          .join("\n")

        return reply(log||"なし")
      }

      // ===== NG =====
      if(msg==="NG追加モード"){
        return reply("NG追加:ワード")
      }

      if(msg.startsWith("NG追加:")){
        const w=msg.replace("NG追加:","")
        g.ngWords.push(w)
        saveDB(db)
        return reply("追加OK")
      }

      if(msg==="NG管理"){
        return reply(g.ngWords.join("\n")||"なし")
      }

      // ===== 擬似キック =====
      if(msg==="キックモード"){
        return reply("⚠ 警告したい人を @名前 で送信")
      }

      // ===== 挨拶 =====
      if(msg==="挨拶設定モード"){
        return reply("挨拶設定:内容")
      }

      if(msg.startsWith("挨拶設定:")){
        g.greeting=msg.replace("挨拶設定:","")
        saveDB(db)
        return reply("設定OK")
      }

      if(msg==="挨拶確認"){
        return reply(g.greeting||"未設定")
      }

      // ===== その他 =====
      if(msg==="ログ"){
        return reply(`通報:${g.reports.length} BAN:${g.bans.length}`)
      }

      if(msg==="グループ情報"){
        return reply(`管理:${g.admins.length} NG:${g.ngWords.length}`)
      }

      if(msg==="リセット"){
        db.groups[gid]=null
        saveDB(db)
        return reply("リセット完了")
      }

      function reply(text){
        return client.replyMessage(event.replyToken,{type:"text",text})
      }

      return reply("OK")
    }

    res.sendStatus(200)

  }catch(e){
    console.log(e)
    res.sendStatus(500)
  }
})

app.listen(process.env.PORT || 3000)
