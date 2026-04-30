import express from "express"
import * as line from "@line/bot-sdk"
import fs from "fs"

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)
const OWNER_ID = "U1a1aca9e44466f8cb05003d7dc86fee0"

// ===== DB =====
const loadDB = () => {
  try { return JSON.parse(fs.readFileSync("db.json")) }
  catch { return { groups: {} } }
}
const saveDB = (db) => {
  fs.writeFileSync("db.json", JSON.stringify(db,null,2))
}

const initGroup = (db, gid) => {
  if (!db.groups[gid]) {
    db.groups[gid] = {
      admins:[OWNER_ID],
      subAdmins:[],
      bans:{},
      ngWords:[],
      reports:[],
      logs:[],
      spamCount:{},
      spamLimit:3,
      mentionSpam:{},
      mentionLimit:3
    }
  }
}

const isAdmin = (g, uid)=>
  g.admins.includes(uid) || g.subAdmins.includes(uid)

const txt = t => ({type:"text",text:t})

// ===== 名前取得 =====
const getName = async (gid, uid) => {
  try{
    const p = await client.getGroupMemberProfile(gid, uid)
    return p.displayName
  }catch{
    return uid
  }
}

// ===== UI =====
const btn = (t, color="#1976D2")=>({
  type:"button",
  style:"primary",
  color,
  action:{type:"message",label:t,text:t}
})

const row = (a,b)=>({
  type:"box",
  layout:"horizontal",
  spacing:"sm",
  contents:[a,b]
})

const menu = () => ({
  type:"flex",
  altText:"管理メニュー",
  contents:{
    type:"bubble",
    body:{
      type:"box",
      layout:"vertical",
      spacing:"md",
      contents:[
        { type:"text", text:"管理メニュー", weight:"bold", size:"lg" },

        row(btn("管理追加"), btn("管理削除")),
        row(btn("副管理登録"), btn("副管理削除")),
        row(btn("管理一覧"), btn("BAN一覧","#D32F2F")),

        row(btn("NG管理"), btn("NG追加")),
        row(btn("通報"), btn("通報ログ")),
        row(btn("通報ランキング"), btn("ログ")),

        row(btn("解除","#2E7D32"), btn("メニュー"))
      ]
    }
  }
})

// ===== MAIN =====
app.post("/webhook", line.middleware(config), async (req,res)=>{
  try{
    const db = loadDB()

    for(const event of req.body.events){

      if(event.type !== "message") continue
      if(event.message.type !== "text") continue

      const gid = event.source.groupId || event.source.userId
      const uid = event.source.userId

      initGroup(db,gid)
      const g = db.groups[gid]

      let msg = event.message.text.trim()
      const mentions = event.message.mention?.mentionees || []

      // ===== ログ =====
      g.logs.push({text:msg,time:Date.now()})
      if(g.logs.length>30) g.logs.shift()

      // ===== 一般ユーザー制限 =====
      if(!isAdmin(g, uid)){

        if(g.bans[uid] >= 3){
          return client.replyMessage(event.replyToken, txt("⚠️ 利用制限中"))
        }

        g.spamCount[uid]=(g.spamCount[uid]||0)+1
        setTimeout(()=>g.spamCount[uid]=0,10000)

        if(g.spamCount[uid]>=g.spamLimit){
          g.bans[uid]++
          saveDB(db)
          return client.replyMessage(event.replyToken, txt("⚠️ 連投警告"))
        }

        // NG
        if(g.ngWords.some(w => msg.includes(w))){
          g.bans[uid]++
          saveDB(db)
          return client.replyMessage(event.replyToken, txt("⚠️ NG検知"))
        }
      }

      let reply = null

      // ===== メニュー =====
      if(msg.includes("メニュー")) reply = menu()

      // ===== 管理追加 =====
      else if(msg.startsWith("管理追加")){
        if(uid !== OWNER_ID){
          reply = txt("⚠️ オーナーのみ")
        }
        else if(!mentions.length){
          reply = txt("メンションして指定")
        }
        else{
          const t = mentions[0].userId
          if(!g.admins.includes(t)){
            g.admins.push(t)
            saveDB(db)
          }
          reply = txt("管理者追加")
        }
      }

      // ===== 管理削除 =====
      else if(msg.startsWith("管理削除")){
        if(uid !== OWNER_ID){
          reply = txt("⚠️ オーナーのみ")
        }
        else if(!mentions.length){
          reply = txt("メンションして指定")
        }
        else{
          const t = mentions[0].userId
          g.admins = g.admins.filter(id=>id!==t)
          saveDB(db)
          reply = txt("管理者削除")
        }
      }

      // ===== 副管理 =====
      else if(msg.includes("副管理登録")){
        if(!isAdmin(g, uid)){
          reply = txt("管理者のみ")
        }
        else if(!mentions.length){
          reply = txt("メンションして指定")
        }
        else{
          const t = mentions[0].userId
          g.subAdmins.push(t)
          saveDB(db)
          reply = txt("副管理登録OK")
        }
      }

      else if(msg.includes("副管理削除")){
        if(!isAdmin(g, uid)){
          reply = txt("管理者のみ")
        }
        else{
          g.subAdmins = g.subAdmins.filter(id=>id!==mentions[0]?.userId)
          saveDB(db)
          reply = txt("副管理削除OK")
        }
      }

      else if(msg.includes("管理一覧")){
        const list = await Promise.all(
          [...g.admins,...g.subAdmins].map(async id=>{
            const name = await getName(gid,id)
            return name
          })
        )
        reply = txt(list.join("\n")||"なし")
      }

      // ===== 通報→自動キック =====
      else if(msg.includes("通報ランキング")){
        const count={}
        g.reports.forEach(r=>{
          count[r.target]=(count[r.target]||0)+1
        })

        const list = await Promise.all(
          Object.entries(count).map(async ([id,c])=>{
            const name = await getName(gid,id)
            return `${name}:${c}`
          })
        )

        reply = txt(list.join("\n")||"なし")
      }

      else if(msg.includes("通報ログ")){
        const list = await Promise.all(
          g.reports.map(async r=>{
            const name = await getName(gid,r.target)
            return name
          })
        )
        reply = txt(list.join("\n")||"なし")
      }

      else if(msg.includes("通報")){
        if(!mentions.length){
          reply = txt("メンションして通報")
        }
        else{
          const t = mentions[0].userId
          g.bans[t]=(g.bans[t]||0)+1
          g.reports.push({target:t,time:Date.now()})

          let text="通報受付"

          if(g.bans[t]>=3){
            g.bans[t]=999
            text="⚠️ 自動キック"
          }

          saveDB(db)
          reply = txt(text)
        }
      }

      // ===== 解除 =====
      else if(msg.startsWith("解除")){
        if(!isAdmin(g, uid)){
          reply = txt("管理者のみ")
        }
        else if(!mentions.length){
          reply = txt("メンションして解除")
        }
        else{
          delete g.bans[mentions[0].userId]
          saveDB(db)
          reply = txt("解除完了")
        }
      }

      // ===== BAN一覧 =====
      else if(msg.includes("BAN一覧")){
        const list = await Promise.all(
          Object.entries(g.bans).map(async ([id,c])=>{
            const name = await getName(gid,id)
            return `${name}:${c}`
          })
        )
        reply = txt(list.join("\n")||"なし")
      }

      // ===== NG =====
      else if(msg.startsWith("NG追加:")){
        g.ngWords.push(msg.replace("NG追加:",""))
        saveDB(db)
        reply = txt("追加OK")
      }

      else if(msg.includes("NG管理")){
        reply = txt(g.ngWords.join("\n")||"なし")
      }

      // ===== ログ =====
      else if(msg.includes("ログ")){
        reply = txt(g.logs.map(l=>l.text).join("\n")||"なし")
      }

      if(reply){
        await client.replyMessage(event.replyToken, reply)
      }
    }

    saveDB(db)
    res.sendStatus(200)

  }catch(e){
    console.log(e)
    res.sendStatus(200)
  }
})

app.listen(process.env.PORT || 3000)
