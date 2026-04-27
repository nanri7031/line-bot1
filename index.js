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
  try { fs.writeFileSync("db.json", JSON.stringify(db,null,2)) }
  catch {}
}

const initGroup = (db, gid) => {
  if (!db.groups[gid]) {
    db.groups[gid] = {
      admins:[OWNER_ID],
      subAdmins:[],
      bans:[],
      ngWords:[],
      reports:[],
      greeting:"",
      users:{}
    }
  }
}

const isAdmin = (g, uid)=>
  g.admins.includes(uid) || g.subAdmins.includes(uid)

// ===== UI =====
const title = t => ({
  type:"text",
  text:t,
  weight:"bold",
  size:"lg",
  color:"#1565C0"
})

const btn = (t, color="#1976D2") => ({
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

// ===== MENU =====
function menu(){
  return {
    type:"flex",
    altText:"管理メニュー",
    contents:{
      type:"bubble",
      body:{
        type:"box",
        layout:"vertical",
        spacing:"md",
        contents:[

          title("管理メニュー"),

          row(btn("管理登録"), btn("副管理登録")),
          row(btn("管理一覧"), btn("管理削除")),

          row(btn("BANモード","#D32F2F"), btn("BAN一覧","#D32F2F")),

          row(btn("NG管理","#0288D1"), btn("NG追加モード","#0288D1")),

          row(btn("通報","#F57C00"), btn("通報ログ","#F57C00")),

          row(btn("挨拶設定モード","#0097A7"), btn("挨拶確認","#0097A7")),

          row(btn("キックモード","#7B1FA2"), btn("ログ","#455A64"))
        ]
      }
    }
  }
}

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

      let replyMsg = null

      // ===== メニュー =====
      if(msg==="メニュー"){
        replyMsg = menu()
      }

      // ===== 管理 =====
      else if(msg==="管理登録"){
        if(!g.admins.includes(uid)){
          g.admins.push(uid)
          saveDB(db)
        }
        replyMsg = txt("管理登録OK")
      }

      else if(msg==="副管理登録"){
        if(!g.subAdmins.includes(uid)){
          g.subAdmins.push(uid)
          saveDB(db)
        }
        replyMsg = txt("副管理OK")
      }

      else if(msg==="管理一覧"){
        replyMsg = txt([...g.admins,...g.subAdmins].join("\n") || "なし")
      }

      else if(msg==="管理削除"){
        g.admins = g.admins.filter(i=>i!==uid)
        saveDB(db)
        replyMsg = txt("削除OK")
      }

      // ===== BAN =====
      else if(msg==="BANモード"){
        replyMsg = txt("@名前でBAN")
      }

      else if(msg.startsWith("@") && isAdmin(g,uid)){
        const name = msg.replace("@","")
        const targetId = Object.keys(g.users)
          .find(id => g.users[id] === name)

        if(targetId){
          if(!g.bans.includes(targetId)){
            g.bans.push(targetId)
            saveDB(db)
          }
          replyMsg = txt("BAN完了")
        } else {
          replyMsg = txt("見つからない")
        }
      }

      else if(msg==="BAN一覧"){
        replyMsg = txt(g.bans.join("\n") || "なし")
      }

      // ===== NG =====
      else if(msg==="NG追加モード"){
        replyMsg = txt("NG追加:ワード")
      }

      else if(msg.startsWith("NG追加:")){
        const w = msg.replace("NG追加:","")
        g.ngWords.push(w)
        saveDB(db)
        replyMsg = txt("追加OK")
      }

      else if(msg==="NG管理"){
        replyMsg = txt(g.ngWords.join("\n") || "なし")
      }

      // ===== 通報 =====
      else if(msg==="通報"){
        g.reports.push({uid,time:Date.now()})
        saveDB(db)
        replyMsg = txt("通報完了")
      }

      else if(msg==="通報ログ"){
        replyMsg = txt("通報数："+g.reports.length)
      }

      // ===== 挨拶 =====
      else if(msg==="挨拶設定モード"){
        replyMsg = txt("挨拶設定:内容")
      }

      else if(msg.startsWith("挨拶設定:")){
        g.greeting = msg.replace("挨拶設定:","")
        saveDB(db)
        replyMsg = txt("設定OK")
      }

      else if(msg==="挨拶確認"){
        replyMsg = txt(g.greeting || "未設定")
      }

      // ===== キック =====
      else if(msg==="キックモード"){
        replyMsg = txt("@名前で警告")
      }

      // ===== ログ =====
      else if(msg==="ログ"){
        replyMsg = txt(`通報:${g.reports.length} NG:${g.ngWords.length}`)
      }

      // ===== デフォルト =====
      else{
        replyMsg = txt("OK")
      }

      // 🔥 必ず1回だけ返信
      if(replyMsg){
        await client.replyMessage(event.replyToken, replyMsg)
      }
    }

    res.sendStatus(200)

  }catch(e){
    console.log(e)
    res.sendStatus(200)
  }
})

const txt = t => ({type:"text",text:t})

app.listen(process.env.PORT || 3000)
