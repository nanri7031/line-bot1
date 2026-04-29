import express from "express"
import * as line from "@line/bot-sdk"
import fs from "fs"

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)

// 自分のUserIdに変更OK
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
      greeting:"",
      spam:{} // 連投管理
    }
  }
}

const isAdmin = (g, uid)=>
  g.admins.includes(uid) || g.subAdmins.includes(uid)

const txt = t => ({type:"text",text:t})

// ===== 名前取得 =====
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

// ===== UI =====
const btn = (t,color="#1976D2")=>({
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

const menu = ()=>({
  type:"flex",
  altText:"管理メニュー",
  contents:{
    type:"bubble",
    body:{
      type:"box",
      layout:"vertical",
      spacing:"md",
      contents:[
        {type:"text",text:"管理メニュー",weight:"bold",size:"lg",color:"#1565C0"},

        row(btn("管理登録"),btn("副管理登録")),
        row(btn("管理解除"),btn("副管理解除")),
        row(btn("管理一覧"),btn("BAN一覧")),

        row(btn("NG管理","#0288D1"),btn("NG追加モード","#0288D1")),

        row(btn("通報","#039BE5"),btn("通報ログ","#039BE5")),
        row(btn("通報ランキング","#039BE5"),btn("ログ","#1E88E5")),

        row(btn("キックモード","#1A237E"),btn("キック","#1A237E")),

        row(btn("挨拶設定モード","#0097A7"),btn("挨拶確認","#0097A7"))
      ]
    }
  }
})

// ===== BANボタン =====
const banBtn = (name,id)=>({
  type:"button",
  style:"primary",
  color:"#D32F2F",
  action:{type:"message",label:`BAN ${name}`,text:`BAN:${id}`}
})

const unbanBtn = (name,id)=>({
  type:"button",
  style:"secondary",
  action:{type:"message",label:`解除 ${name}`,text:`BAN解除:${id}`}
})

// ===== MAIN =====
app.post("/webhook", line.middleware(config), async (req,res)=>{
  try{
    const db = loadDB()

    for(const event of req.body.events){

      const gid = event.source.groupId || event.source.userId
      const uid = event.source.userId

      initGroup(db,gid)
      const g = db.groups[gid]

      // ===== スタンプ連打 =====
      if(event.type==="message" && event.message.type==="sticker"){
        if(!isAdmin(g,uid)){
          const now=Date.now()
          if(!g.spam[uid]) g.spam[uid]={count:0,last:0}

          if(now-g.spam[uid].last<3000) g.spam[uid].count++
          else g.spam[uid].count=1

          g.spam[uid].last=now

          if(g.spam[uid].count>=3){
            g.bans[uid]=(g.bans[uid]||0)+1
            saveDB(db)
            return await client.replyMessage(event.replyToken,txt("⚠️ スタンプ連打禁止"))
          }
        }
        continue
      }

      if(event.type!=="message") continue
      if(event.message.type!=="text") continue

      const msg = event.message.text
      const mentions = event.message.mention?.mentionees || []
      const name = await getName(gid,uid,g)

      // ===== 連投 =====
      if(!isAdmin(g,uid)){
        const now=Date.now()
        if(!g.spam[uid]) g.spam[uid]={count:0,last:0}

        if(now-g.spam[uid].last<3000) g.spam[uid].count++
        else g.spam[uid].count=1

        g.spam[uid].last=now

        if(g.spam[uid].count>=5){
          g.bans[uid]=(g.bans[uid]||0)+1
          saveDB(db)
          return await client.replyMessage(event.replyToken,txt(`⚠️ ${name} 連投禁止`))
        }
      }

      // ===== BAN制限 =====
      if(g.bans[uid]>=3){
        return await client.replyMessage(event.replyToken,txt("⚠️ 利用制限中"))
      }

      // ===== NG =====
      if(!isAdmin(g,uid) && g.ngWords.some(w=>msg.includes(w))){
        g.bans[uid]=(g.bans[uid]||0)+1
        saveDB(db)
        return await client.replyMessage(event.replyToken,txt(`⚠️ ${name} NG検知`))
      }

      let reply=null

      // ===== メニュー =====
      if(msg==="メニュー") reply=menu()

      // ===== 管理 =====
      else if(msg==="管理登録"){ g.admins.push(uid); saveDB(db); reply=txt("OK") }
      else if(msg==="副管理登録"){ g.subAdmins.push(uid); saveDB(db); reply=txt("OK") }

      else if(msg==="管理解除"){
        if(mentions.length>0) g.admins=g.admins.filter(id=>id!==mentions[0].userId)
        else g.admins=g.admins.filter(id=>id!==uid)
        saveDB(db)
        reply=txt("OK")
      }

      else if(msg==="副管理解除"){
        if(mentions.length>0) g.subAdmins=g.subAdmins.filter(id=>id!==mentions[0].userId)
        else g.subAdmins=g.subAdmins.filter(id=>id!==uid)
        saveDB(db)
        reply=txt("OK")
      }

      else if(msg==="管理一覧"){
        reply=txt([...g.admins,...g.subAdmins].join("\n")||"なし")
      }

      // ===== NG管理 =====
      else if(msg==="NG追加モード") reply=txt("NG追加:ワード")
      else if(msg.startsWith("NG追加:")){
        g.ngWords.push(msg.replace("NG追加:",""))
        saveDB(db)
        reply=txt("追加OK")
      }
      else if(msg==="NG管理"){
        reply=txt(g.ngWords.join("\n")||"なし")
      }

      // ===== 通報 =====
      else if(msg==="通報" && mentions.length>0){
        const t=mentions[0].userId
        const tName=await getName(gid,t,g)
        g.reports.push({target:t,name:tName,time:Date.now()})
        g.bans[t]=(g.bans[t]||0)+1
        saveDB(db)
        reply=txt(`通報:${tName}`)
      }

      else if(msg==="通報ログ"){
        reply=txt(g.reports.map(r=>r.name).join("\n")||"なし")
      }

      else if(msg==="通報ランキング"){
        const c={}
        g.reports.forEach(r=>c[r.name]=(c[r.name]||0)+1)
        reply=txt(Object.entries(c).sort((a,b)=>b[1]-a[1]).map(v=>v.join(":")).join("\n"))
      }

      // ===== BAN =====
      else if(msg==="BAN一覧"){
        const rows=Object.entries(g.users).map(([id,n])=>({
          type:"box",
          layout:"horizontal",
          contents:[banBtn(n,id),unbanBtn(n,id)]
        }))
        reply={type:"flex",altText:"BAN",contents:{type:"bubble",body:{type:"box",layout:"vertical",contents:rows}}}
      }

      else if(msg.startsWith("BAN:")){
        g.bans[msg.replace("BAN:","")]=999
        saveDB(db)
        reply=txt("BAN")
      }

      else if(msg.startsWith("BAN解除:")){
        delete g.bans[msg.replace("BAN解除:","")]
        saveDB(db)
        reply=txt("解除")
      }

      // ===== キック =====
      else if(msg==="キック" && mentions.length>0){
        const t=mentions[0].userId
        const tName=await getName(gid,t,g)
        g.bans[t]=999
        saveDB(db)
        reply=txt(`⚠️ ${tName} キック`)
      }

      // ===== 挨拶 =====
      else if(msg.startsWith("挨拶設定:")){
        g.greeting=msg.replace("挨拶設定:","")
        saveDB(db)
        reply=txt("OK")
      }

      else if(msg==="挨拶確認"){
        reply=txt(g.greeting||"未設定")
      }

      // ===== みくちゃん（修正版）=====
      else if(msg.includes("みくちゃん")){
        const t=msg.replace("みくちゃん","")
        if(t.includes("おは")) reply=txt("おはよう☀️")
        else if(t.includes("あり")) reply=txt("どういたしまして😊")
        else if(t.includes("おつ")) reply=txt("お疲れ様✨")
        else reply=txt("呼んだ？😊")
      }

      if(reply){
        await client.replyMessage(event.replyToken,reply)
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
