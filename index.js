import express from "express"
import * as line from "@line/bot-sdk"
import { google } from "googleapis"

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)
const OWNER_ID = "U1a1aca9e44466f8cb05003d7dc86fee0"

// ===== Google =====
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
})

const sheets = google.sheets({ version:"v4", auth })
const SPREADSHEET_ID = "ここにID"

// ===== DB =====
const loadDB = async () => {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "line_bot_db!A:B"
  })

  const db={groups:{}}
  const rows=res.data.values||[]

  rows.slice(1).forEach(r=>{
    try{ db.groups[r[0]]=JSON.parse(r[1]) }catch{}
  })

  return db
}

const saveDB = async (db) => {
  const rows=[["groupId","data"]]
  for(const gid in db.groups){
    rows.push([gid,JSON.stringify(db.groups[gid])])
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range:"line_bot_db!A1",
    valueInputOption:"RAW",
    requestBody:{values:rows}
  })
}

// ===== 初期 =====
const initGroup=(db,gid)=>{
  if(!db.groups[gid]){
    db.groups[gid]={
      admins:[OWNER_ID],
      subAdmins:[],
      bans:{},
      reports:{},
      ngWords:[],
      logs:[],
      spamCount:{},
      spamLimit:3,
      greet:true,
      silent:false
    }
  }
}

const isAdmin=(g,uid)=>g.admins.includes(uid)||g.subAdmins.includes(uid)
const txt=t=>({type:"text",text:t})

// ===== 名前 =====
const getName=async(gid,uid)=>{
  try{
    const p=await client.getGroupMemberProfile(gid,uid)
    return p.displayName
  }catch{return uid}
}

// ===== 挨拶 =====
const greetings=["おはよう！","こんにちは！","おつかれ！","こんばんは！","ありがとう！"]

// ===== メイン =====
app.post("/webhook", line.middleware(config), async (req,res)=>{
  try{
    const db=await loadDB()

    for(const event of req.body.events){

      if(event.type!=="message") continue
      if(event.message.type!=="text") continue

      const gid=event.source.groupId||event.source.userId
      const uid=event.source.userId

      initGroup(db,gid)
      const g=db.groups[gid]

      let msg=event.message.text.trim()
      const mentions=event.message.mention?.mentionees||[]

      // ===== 稼働確認 =====
      if(msg==="確認"){
        await client.replyMessage(event.replyToken, txt("✅ BOT稼働中"))
        continue
      }

      // ===== サイレント =====
      if(g.silent && !isAdmin(g,uid)) continue

      // ===== ログ =====
      g.logs.push(msg)
      if(g.logs.length>30) g.logs.shift()

      // ===== BAN中 =====
      if(g.bans[uid]>=3){
        await client.replyMessage(event.replyToken, txt("⚠️ 利用制限中"))
        continue
      }

      // ===== 挨拶 =====
      if(g.greet && ["おは","こん","おつ","あり"].some(w=>msg.includes(w))){
        const r=greetings[Math.floor(Math.random()*greetings.length)]
        await client.replyMessage(event.replyToken, txt(r))
        continue
      }

      // ===== NG =====
      if(g.ngWords.some(w=>msg.includes(w))){
        g.bans[uid]=(g.bans[uid]||0)+1
        await saveDB(db)
        await client.replyMessage(event.replyToken, txt("⚠️ NG検知"))
        continue
      }

      // ===== 連投 =====
      g.spamCount[uid]=(g.spamCount[uid]||0)+1
      setTimeout(()=>g.spamCount[uid]=0,10000)

      if(g.spamCount[uid]>=g.spamLimit){
        g.bans[uid]=(g.bans[uid]||0)+1
        await saveDB(db)
        await client.replyMessage(event.replyToken, txt("⚠️ 連投警告"))
        continue
      }

      let reply=null

      // ===== 管理 =====
      if(msg.startsWith("管理追加")){
        if(uid!==OWNER_ID) reply=txt("オーナーのみ")
        else{
          g.admins.push(mentions[0]?.userId)
          reply=txt("管理追加")
        }
      }

      else if(msg.startsWith("管理削除")){
        if(uid!==OWNER_ID) reply=txt("オーナーのみ")
        else{
          g.admins=g.admins.filter(id=>id!==mentions[0]?.userId)
          reply=txt("削除")
        }
      }

      else if(msg.includes("副管理登録")){
        if(!isAdmin(g,uid)) reply=txt("管理者のみ")
        else{
          g.subAdmins.push(mentions[0]?.userId)
          reply=txt("副管理登録")
        }
      }

      else if(msg.includes("副管理削除")){
        g.subAdmins=g.subAdmins.filter(id=>id!==mentions[0]?.userId)
        reply=txt("副管理削除")
      }

      else if(msg.includes("管理一覧")){
        const list=await Promise.all([...g.admins,...g.subAdmins].map(id=>getName(gid,id)))
        reply=txt(list.join("\n"))
      }

      // ===== 通報 =====
      else if(msg.includes("通報")){
        const t=mentions[0]?.userId
        if(!t) reply=txt("メンションして")
        else{
          g.reports[t]=(g.reports[t]||0)+1
          if(g.reports[t]>=3){
            g.bans[t]=999
            reply=txt("⚠️ 自動BAN")
          }else{
            reply=txt("通報受付")
          }
        }
      }

      else if(msg.includes("BAN一覧")){
        const list=await Promise.all(
          Object.entries(g.bans).map(async([id,c])=>`${await getName(gid,id)}:${c}`)
        )
        reply=txt(list.join("\n")||"なし")
      }

      else if(msg.startsWith("解除")){
        if(!isAdmin(g,uid)) reply=txt("管理者のみ")
        else{
          delete g.bans[mentions[0]?.userId]
          reply=txt("解除完了")
        }
      }

      // ===== NG =====
      else if(msg.startsWith("NG追加:")){
        g.ngWords.push(msg.replace("NG追加:",""))
        reply=txt("追加OK")
      }

      else if(msg.includes("NG管理")){
        reply=txt(g.ngWords.join("\n")||"なし")
      }

      // ===== 設定 =====
      else if(msg.startsWith("連投設定:")){
        g.spamLimit=parseInt(msg.split(":")[1])
        reply=txt("変更OK")
      }

      else if(msg==="挨拶OFF"){
        g.greet=false
        reply=txt("OFF")
      }

      else if(msg==="挨拶ON"){
        g.greet=true
        reply=txt("ON")
      }

      else if(msg==="無反応ON"){
        g.silent=true
        reply=txt("無反応ON")
      }

      else if(msg==="無反応OFF"){
        g.silent=false
        reply=txt("無反応OFF")
      }

      if(reply){
        await saveDB(db)
        await client.replyMessage(event.replyToken, reply)
      }
    }

    await saveDB(db)
    res.sendStatus(200)

  }catch(e){
    console.log(e)
    res.sendStatus(200)
  }
})

app.listen(process.env.PORT||3000)
