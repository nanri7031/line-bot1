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
      users:{},
      greeting:""
    }
  }
}

const isAdmin = (g, uid)=>
  g.admins.includes(uid) || g.subAdmins.includes(uid)

const txt = t => ({type:"text",text:t})

// ===== 名前取得（キャッシュ）=====
const getName = async (gid, uid, g)=>{
  if(g.users[uid]) return g.users[uid]

  try{
    const p = await client.getGroupMemberProfile(gid, uid)
    g.users[uid] = p.displayName
    return p.displayName
  }catch{
    return uid
  }
}

// ===== MAIN =====
app.post("/webhook", line.middleware(config), async (req,res)=>{
  try{

    const db = loadDB()

    for(const event of req.body.events){

      if(event.type === "memberJoined"){
        const gid = event.source.groupId
        initGroup(db,gid)
        const g = db.groups[gid]

        if(g.greeting){
          await client.pushMessage(gid, txt(g.greeting))
        }
        continue
      }

      if(event.type !== "message") continue
      if(event.message.type !== "text") continue

      const gid = event.source.groupId || event.source.userId
      const uid = event.source.userId

      initGroup(db,gid)
      const g = db.groups[gid]

      const msg = event.message.text
      const mentions = event.message.mention?.mentionees || []

      const name = await getName(gid, uid, g)

      // ===== ログ =====
      g.logs.push({user:name,text:msg,time:Date.now()})
      if(g.logs.length>50) g.logs.shift()

      // ===== BAN制限 =====
      if(g.bans[uid] >= 3){
        return await client.replyMessage(event.replyToken, txt("⚠️ 利用制限中"))
      }

      // ===== NG検知 =====
      if(!isAdmin(g,uid) && g.ngWords.some(w => msg.includes(w))){
        g.bans[uid] = (g.bans[uid] || 0) + 1
        g.reports.push({target:uid,name,time:Date.now()})
        saveDB(db)

        return await client.replyMessage(
          event.replyToken,
          txt(`⚠️ ${name} NG検知（${g.bans[uid]}回）`)
        )
      }

      let reply = null

      // ===== 自動注意 =====
      if(g.bans[uid] === 2){
        reply = txt(`⚠️ ${name} あと1回で制限`)
      }

      // ===== 通報 =====
      else if(msg==="通報" && mentions.length>0){
        const target = mentions[0].userId
        const tName = await getName(gid,target,g)

        g.reports.push({target,name:tName,time:Date.now()})
        g.bans[target] = (g.bans[target] || 0) + 1

        saveDB(db)
        reply = txt(`通報受付: ${tName}`)
      }

      // ===== 通報ログ =====
      else if(msg==="通報ログ"){
        const log = g.reports
          .map(r=>`${r.name}`)
          .join("\n")
        reply = txt(log || "なし")
      }

      // ===== 通報ランキング =====
      else if(msg==="通報ランキング"){
        const count = {}

        g.reports.forEach(r=>{
          count[r.name] = (count[r.name]||0)+1
        })

        const ranking = Object.entries(count)
          .sort((a,b)=>b[1]-a[1])
          .map(([n,c])=>`${n}: ${c}`)
          .join("\n")

        reply = txt(ranking || "なし")
      }

      // ===== キック =====
      else if(msg==="キック" && mentions.length>0){
        const target = mentions[0].userId
        const tName = await getName(gid,target,g)

        g.bans[target] = 999
        saveDB(db)

        reply = txt(`⚠️ ${tName} キック`)
      }

      // ===== ログ =====
      else if(msg==="ログ"){
        const log = g.logs
          .map(l=>`${l.user}: ${l.text}`)
          .join("\n")

        reply = txt(log || "なし")
      }

      // ===== BAN一覧 =====
      else if(msg==="BAN一覧"){
        const list = Object.entries(g.bans)
          .map(([id,c])=>`${g.users[id]||id}: ${c}`)
          .join("\n")

        reply = txt(list || "なし")
      }

      // ===== NG追加 =====
      else if(msg.startsWith("NG追加:")){
        const w = msg.replace("NG追加:","")
        g.ngWords.push(w)
        saveDB(db)
        reply = txt("追加OK")
      }

      // ===== みくちゃん =====
      else if(msg.startsWith("みくちゃん")){
        const t = msg.replace("みくちゃん","").trim()
        const pick = a=>a[Math.floor(Math.random()*a.length)]

        if(t.includes("おは")) reply = txt(pick(["おはよう☀️","今日も頑張ろ😊"]))
        else if(t.includes("ありが")) reply = txt(pick(["どういたしまして😊"]))
        else if(t.includes("おつ")) reply = txt(pick(["お疲れ様✨"]))
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
