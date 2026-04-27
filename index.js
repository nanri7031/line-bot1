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

// ===== メニュー =====
function menu(){
  return {
    type:"flex",
    altText:"管理メニュー",
    contents:{
      type:"bubble",
      body:{
        type:"box",
        layout:"vertical",
        contents:[
          txt("管理メニュー"),
          row("管理登録","副管理登録"),
          row("管理一覧","管理削除"),
          row("BANモード","BAN一覧"),
          row("NG管理","NG追加モード"),
          row("通報","通報ログ"),
          row("挨拶設定モード","挨拶確認"),
          row("キックモード","ログ")
        ]
      }
    }
  }
}

const txt=t=>({type:"text",text:t,weight:"bold"})
const row=(a,b)=>({
  type:"box",layout:"horizontal",
  contents:[btn(a),btn(b)]
})
const btn=t=>({
  type:"button",
  action:{type:"message",label:t,text:t}
})

// ===== メイン =====
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
        replyMsg = {type:"text",text:"管理登録OK"}
      }

      else if(msg==="管理一覧"){
        replyMsg = {
          type:"text",
          text: g.admins.join("\n") || "なし"
        }
      }

      // ===== BAN =====
      else if(msg==="BANモード"){
        replyMsg = {type:"text",text:"@名前でBAN"}
      }

      else if(msg.startsWith("@") && isAdmin(g,uid)){
        replyMsg = {type:"text",text:"BAN完了"}
      }

      // ===== デフォルト =====
      else{
        replyMsg = {type:"text",text:"OK"}
      }

      // 🔥 ここが最重要（1回だけ）
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

app.listen(process.env.PORT || 3000)
