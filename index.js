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
        row(btn("管理一覧"), btn("NG管理")),

        row(btn("NG追加モード"), btn("通報")),
        row(btn("通報ログ"), btn("通報ランキング")),

        row(btn("キックモード"), btn("ログ")),
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

      // ===== BAN制限 =====
      if(g.bans[uid] >= 3){
        return await client.replyMessage(event.replyToken, txt("⚠️ 利用制限中"))
      }

      // ===== 連投検知 =====
      g.spamCount[uid] = (g.spamCount[uid] || 0) + 1

      setTimeout(() => { g.spamCount[uid] = 0 }, 10000)

      if(g.spamCount[uid] >= g.spamLimit){
        g.bans[uid] = (g.bans[uid] || 0) + 1
        saveDB(db)

        return await client.replyMessage(
          event.replyToken,
          txt(`⚠️ 連投警告（${g.bans[uid]}回）`)
        )
      }

      // ===== メンション過多 =====
      if(mentions.length >= 5){
        g.bans[uid] = (g.bans[uid] || 0) + 1
        saveDB(db)

        return await client.replyMessage(
          event.replyToken,
          txt(`⚠️ メンション多すぎ`)
        )
      }

      // ===== メンション連投 =====
      if(mentions.length > 0){
        g.mentionSpam[uid] = (g.mentionSpam[uid] || 0) + 1

        setTimeout(()=>{ g.mentionSpam[uid] = 0 },10000)

        if(g.mentionSpam[uid] >= g.mentionLimit){
          g.bans[uid] = (g.bans[uid] || 0) + 1
          saveDB(db)

          return await client.replyMessage(
            event.replyToken,
            txt(`⚠️ メンション連投`)
          )
        }
      }

      let reply = null

      // ===== メニュー =====
      if(msg==="メニュー") reply = menu()

      // ===== 管理 =====
      else if(msg==="管理登録"){
        if(!g.admins.includes(uid)){
          g.admins.push(uid)
          saveDB(db)
        }
        reply = txt("管理登録OK")
      }

      else if(msg==="副管理登録"){
        if(!g.subAdmins.includes(uid)){
          g.subAdmins.push(uid)
          saveDB(db)
        }
        reply = txt("副管理登録OK")
      }

      else if(msg==="管理一覧"){
        reply = txt([...g.admins,...g.subAdmins].join("\n") || "なし")
      }

      // ===== NG =====
      else if(msg==="NG追加モード"){
        reply = txt("NG追加:ワード")
      }

      else if(msg.startsWith("NG追加:")){
        const w = msg.replace("NG追加:","")
        g.ngWords.push(w)
        saveDB(db)
        reply = txt("追加OK")
      }

      else if(msg==="NG管理"){
        reply = txt(g.ngWords.join("\n") || "なし")
      }

      // ===== 通報 =====
      else if(msg==="通報"){
        if(mentions.length===0){
          reply = txt("メンションして通報")
        }else{
          const target = mentions[0].userId
          g.bans[target]=(g.bans[target]||0)+1
          g.reports.push({target,time:Date.now()})
          saveDB(db)
          reply = txt("通報受付")
        }
      }

      else if(msg==="通報ログ"){
        reply = txt(g.reports.map(r=>r.target).join("\n") || "なし")
      }

      else if(msg==="通報ランキング"){
        const count={}
        g.reports.forEach(r=>{
          count[r.target]=(count[r.target]||0)+1
        })
        reply = txt(
          Object.entries(count)
          .sort((a,b)=>b[1]-a[1])
          .map(([id,c])=>`${id}:${c}`).join("\n") || "なし"
        )
      }

      // ===== キック =====
      else if(msg==="キックモード"){
        reply = txt("メンションして『キック』")
      }

      else if(msg==="キック"){
        if(mentions.length===0){
          reply = txt("メンション必須")
        }else{
          const target = mentions[0].userId
          g.bans[target]=999
          saveDB(db)
          reply = txt("キック実行")
        }
      }

      // ===== ログ =====
      else if(msg==="ログ"){
        reply = txt(g.logs.map(l=>l.text).join("\n") || "なし")
      }

      // ===== 挨拶 =====
      else if(msg==="挨拶設定モード"){
        reply = txt("挨拶設定:内容")
      }

      else if(msg.startsWith("挨拶設定:")){
        g.greeting = msg.replace("挨拶設定:","")
        saveDB(db)
        reply = txt("設定OK")
      }

      else if(msg==="挨拶確認"){
        reply = txt(g.greeting || "未設定")
      }

      // ===== BAN一覧 =====
      else if(msg==="BAN一覧"){
        reply = txt(
          Object.entries(g.bans)
          .map(([id,c])=>`${id}:${c}`).join("\n") || "なし"
        )
      }

      // ===== 設定変更 =====
      else if(msg.startsWith("連投設定:")){
        const n = parseInt(msg.replace("連投設定:",""))
        if(!isNaN(n)){
          g.spamLimit = n
          saveDB(db)
          reply = txt(`連投制限:${n}`)
        }
      }

      else if(msg.startsWith("メンション設定:")){
        const n = parseInt(msg.replace("メンション設定:",""))
        if(!isNaN(n)){
          g.mentionLimit = n
          saveDB(db)
          reply = txt(`メンション制限:${n}`)
        }
      }

      // ===== NG検知 =====
      else if(!isAdmin(g,uid) && g.ngWords.some(w => msg.includes(w))){
        g.bans[uid]=(g.bans[uid]||0)+1
        saveDB(db)

        return await client.replyMessage(
          event.replyToken,
          txt(`⚠️ NG検知（${g.bans[uid]}回）`)
        )
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
