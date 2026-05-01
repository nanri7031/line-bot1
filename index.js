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

// ===== 永続化パス =====
const DB_PATH = "/mnt/data/db.json"

// ===== DB =====
const loadDB = () => {
  try { return JSON.parse(fs.readFileSync(DB_PATH)) }
  catch { return { groups: {} } }
}
const saveDB = (db) => {
  fs.writeFileSync(DB_PATH, JSON.stringify(db,null,2))
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
      contents:[
        { type:"text", text:"管理メニュー", weight:"bold" },

        row(btn("管理追加"), btn("管理削除")),
        row(btn("副管理登録"), btn("副管理削除")),
        row(btn("管理一覧"), btn("BAN一覧")),

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

      // ===== 連投制御 =====
      if(!isAdmin(g, uid)){
        g.spamCount[uid]=(g.spamCount[uid]||0)+1
        setTimeout(()=>g.spamCount[uid]=0,10000)

        if(g.spamCount[uid]>=g.spamLimit){
          g.bans[uid]=(g.bans[uid]||0)+1
          saveDB(db)
          return client.replyMessage(event.replyToken, txt("⚠️ 連投警告"))
        }

        if(g.ngWords.some(w => msg.includes(w))){
          g.bans[uid]++
          saveDB(db)
          return client.replyMessage(event.replyToken, txt("⚠️ NG検知"))
        }
      }

      let reply = null

      // ===== メニュー =====
      if(msg.includes("メニュー")) reply = menu()

      // ===== 設定 =====
      else if(msg.startsWith("連投設定:")){
        if(!isAdmin(g,uid)) reply=txt("管理者のみ")
        else{
          const n = parseInt(msg.replace("連投設定:",""))
          if(!isNaN(n)){
            g.spamLimit=n
            saveDB(db)
            reply=txt(`連投制限:${n}`)
          }
        }
      }

      else if(msg.startsWith("メンション設定:")){
        if(!isAdmin(g,uid)) reply=txt("管理者のみ")
        else{
          const n = parseInt(msg.replace("メンション設定:",""))
          if(!isNaN(n)){
            g.mentionLimit=n
            saveDB(db)
            reply=txt(`メンション制限:${n}`)
          }
        }
      }

      // ===== 管理 =====
      else if(msg.startsWith("管理追加")){
        if(uid!==OWNER_ID) reply=txt("オーナーのみ")
        else if(!mentions.length) reply=txt("メンションして")
        else{
          g.admins.push(mentions[0].userId)
          saveDB(db)
          reply=txt("管理追加")
        }
      }

      else if(msg.startsWith("管理削除")){
        if(uid!==OWNER_ID) reply=txt("オーナーのみ")
        else{
          g.admins = g.admins.filter(id=>id!==mentions[0]?.userId)
          saveDB(db)
          reply=txt("管理削除")
        }
      }

      // ===== 副管理 =====
      else if(msg.includes("副管理登録")){
        if(!isAdmin(g,uid)) reply=txt("管理者のみ")
        else if(!mentions.length) reply=txt("メンションして")
        else{
          g.subAdmins.push(mentions[0].userId)
          saveDB(db)
          reply=txt("副管理登録")
        }
      }

      else if(msg.includes("副管理削除")){
        if(!isAdmin(g,uid)) reply=txt("管理者のみ")
        else{
          g.subAdmins = g.subAdmins.filter(id=>id!==mentions[0]?.userId)
          saveDB(db)
          reply=txt("副管理削除")
        }
      }

      else if(msg.includes("管理一覧")){
        const list = await Promise.all(
          [...g.admins,...g.subAdmins].map(async id=>{
            return await getName(gid,id)
          })
        )
        reply = txt(list.join("\n")||"なし")
      }

      // ===== 通報 =====
      else if(msg.includes("通報ランキング")){
        const count={}
        g.reports.forEach(r=>{
          count[r.target]=(count[r.target]||0)+1
        })

        const list = await Promise.all(
          Object.entries(count).map(async ([id,c])=>{
            return `${await getName(gid,id)}:${c}`
          })
        )

        reply = txt(list.join("\n")||"なし")
      }

      else if(msg.includes("通報ログ")){
        const list = await Promise.all(
          g.reports.map(async r=>{
            return await getName(gid,r.target)
          })
        )
        reply = txt(list.join("\n")||"なし")
      }

      else if(msg.includes("通報")){
        if(!mentions.length) reply=txt("メンションして")
        else{
          const t=mentions[0].userId
          g.bans[t]=(g.bans[t]||0)+1
          g.reports.push({target:t})

          let text="通報受付"
          if(g.bans[t]>=3){
            g.bans[t]=999
            text="⚠️ 自動キック"
          }

          saveDB(db)
          reply=txt(text)
        }
      }

      // ===== 解除 =====
      else if(msg.startsWith("解除")){
        if(!isAdmin(g,uid)) reply=txt("管理者のみ")
        else if(!mentions.length) reply=txt("メンションして")
        else{
          delete g.bans[mentions[0].userId]
          saveDB(db)
          reply=txt("解除完了")
        }
      }

      // ===== BAN一覧 =====
      else if(msg.includes("BAN一覧")){
        const list = await Promise.all(
          Object.entries(g.bans).map(async ([id,c])=>{
            return `${await getName(gid,id)}:${c}`
          })
        )
        reply = txt(list.join("\n")||"なし")
      }

      // ===== NG =====
      else if(msg.startsWith("NG追加:")){
        g.ngWords.push(msg.replace("NG追加:",""))
        saveDB(db)
        reply=txt("追加OK")
      }

      else if(msg.includes("NG管理")){
        reply=txt(g.ngWords.join("\n")||"なし")
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
