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
      bans:{}, // ← 変更（回数管理）
      ngWords:[],
      reports:[],
      greeting:""
    }
  }
}

const isAdmin = (g, uid)=>
  g.admins.includes(uid) || g.subAdmins.includes(uid)

const txt = t => ({type:"text",text:t})

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

      const msg = event.message.text

      // ===== メンション取得 =====
      const mentions = event.message.mention?.mentionees || []

      // ===== BANチェック =====
      if(g.bans[uid] >= 3){
        return await client.replyMessage(event.replyToken, txt("⚠️ 利用制限中です"))
      }

      // ===== NG検知（自動BAN）=====
      if(!isAdmin(g,uid) && g.ngWords.some(w => msg.includes(w))){
        
        g.bans[uid] = (g.bans[uid] || 0) + 1
        saveDB(db)

        return await client.replyMessage(event.replyToken,
          txt(`⚠️ NG検知（${g.bans[uid]}回目）`)
        )
      }

      let reply = null

      // ===== 通報（メンション対象）=====
      if(msg === "通報" && mentions.length > 0){

        const target = mentions[0].userId

        g.reports.push({target, time:Date.now()})
        g.bans[target] = (g.bans[target] || 0) + 1

        saveDB(db)

        reply = txt(`通報受付（対象違反+1）`)
      }

      // ===== BAN一覧 =====
      else if(msg === "BAN一覧"){
        const list = Object.entries(g.bans)
          .map(([id,c])=>`${id}:${c}`)
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

      // ===== みくちゃん会話 =====
      else if(msg.startsWith("みくちゃん")){

        const text = msg.replace("みくちゃん","").trim()
        const pick = arr => arr[Math.floor(Math.random()*arr.length)]

        if(["おはよう"].includes(text)){
          reply = txt(pick(["おはよう☀️","今日も頑張ろ😊"]))
        }

        else if(["ありがとう"].includes(text)){
          reply = txt(pick(["どういたしまして😊","いえいえ✨"]))
        }

        else if(["おつ"].includes(text)){
          reply = txt(pick(["お疲れ様✨","ゆっくりしてね☕"]))
        }
      }

      // ===== メンション挨拶 =====
      else if(mentions.some(m=>m.userId===config.channelAccessToken)){
        reply = txt("呼んだ？😊")
      }

      if(reply){
        await client.replyMessage(event.replyToken, reply)
      }
    }

    res.sendStatus(200)

  }catch(e){
    console.log(e)
    res.sendStatus(200)
  }
})

app.listen(process.env.PORT || 3000)
