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
      greeting:"",
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
        { type:"text", text:"管理メニュー", weight:"bold", size:"lg", color:"#1565C0" },

        row(btn("管理登録"), btn("副管理登録")),
        row(btn("副管理削除"), btn("管理一覧")),

        row(btn("NG管理"), btn("NG追加モード")),
        row(btn("通報"), btn("通報ログ")),
        row(btn("通報ランキング"), btn("ログ")),

        row(btn("キックモード"), btn("解除","#2E7D32")),
        row(btn("挨拶設定モード"), btn("挨拶確認")),

        row(btn("BAN一覧","#D32F2F"), btn("メニュー"))
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

      const msg = event.message.text.trim()
      const mentions = event.message.mention?.mentionees || []

      // ===== ログ =====
      g.logs.push({text:msg,time:Date.now()})
      if(g.logs.length>50) g.logs.shift()

      // ===== 管理者は制限対象外 =====
      if(!isAdmin(g, uid)){

        if(g.bans[uid] >= 3){
          return await client.replyMessage(event.replyToken, txt("⚠️ 利用制限中"))
        }

        g.spamCount[uid] = (g.spamCount[uid] || 0) + 1
        setTimeout(()=>{ g.spamCount[uid] = 0 },10000)

        if(g.spamCount[uid] >= g.spamLimit){
          g.bans[uid] = (g.bans[uid] || 0) + 1
          saveDB(db)
          return await client.replyMessage(event.replyToken, txt("⚠️ 連投警告"))
        }

        if(mentions.length >= 5){
          g.bans[uid] = (g.bans[uid] || 0) + 1
          saveDB(db)
          return await client.replyMessage(event.replyToken, txt("⚠️ メンション多すぎ"))
        }

        if(mentions.length > 0){
          g.mentionSpam[uid] = (g.mentionSpam[uid] || 0) + 1
          setTimeout(()=>{ g.mentionSpam[uid] = 0 },10000)

          if(g.mentionSpam[uid] >= g.mentionLimit){
            g.bans[uid] = (g.bans[uid] || 0) + 1
            saveDB(db)
            return await client.replyMessage(event.replyToken, txt("⚠️ メンション連投"))
          }
        }

        if(g.ngWords.some(w => msg.includes(w))){
          g.bans[uid] = (g.bans[uid] || 0) + 1
          saveDB(db)
          return await client.replyMessage(event.replyToken, txt(`⚠️ NG検知（${g.bans[uid]}回）`))
        }
      }

      let reply = null

      if(msg==="メニュー") reply = menu()

      else if(msg==="解除"){
        if(!isAdmin(g, uid)){
          reply = txt("⚠️ 管理者のみ")
        }else if(mentions.length===0){
          reply = txt("メンションして解除")
        }else{
          const target = mentions[0].userId
          delete g.bans[target]
          saveDB(db)
          reply = txt("✅ 利用制限解除")
        }
      }

      // 他コマンドは前の完全版と同じなので省略（全部入ってる前提）

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
