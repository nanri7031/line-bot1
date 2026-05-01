import express from 'express'
import * as line from '@line/bot-sdk'
import { google } from 'googleapis'

// ===== LINE設定 =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
}

// ===== Google Sheets設定 =====
const SPREADSHEET_ID = process.env.SPREADSHEET_ID

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})

const sheets = google.sheets({ version: 'v4', auth })

// ===== 管理者ID =====
const ADMIN_IDS = [
  "U1a1aca9e44466f8cb05003d7dc86fee0"
]

// ===== Express =====
const app = express()
app.use(express.json())

const client = new line.Client(config)

// ===== Webhook =====
app.post('/webhook', line.middleware(config), async (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then(() => res.json({ success: true }))
    .catch(err => {
      console.error(err)
      res.status(500).end()
    })
})

// ===== メイン処理 =====
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null
  }

  const text = event.message.text
  const userId = event.source.userId
  const groupId = event.source.groupId || "個人"

  // ===== BOT確認 =====
  if (text === '確認') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'BOT正常🔥'
    })
  }

  // ===== 管理者追加 =====
  if (text.startsWith('管理追加')) {
    if (!ADMIN_IDS.includes(userId)) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '権限なし'
      })
    }

    const newId = text.replace('管理追加', '').trim()

    if (!newId) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ID指定して'
      })
    }

    ADMIN_IDS.push(newId)

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `追加完了: ${newId}`
    })
  }

  // ===== 管理者一覧 =====
  if (text === '管理一覧') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: ADMIN_IDS.join('\n')
    })
  }

  // ===== データ保存 =====
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'A:B',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[groupId, text]]
    }
  })

  return null
}

// ===== サーバー起動 =====
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`起動中: ${PORT}`)
})
