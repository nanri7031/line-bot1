import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import { google } from "googleapis";

const app = express();

// ===== LINE =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new Client(config);

// ===== push =====
const push = async (userId, text) => {
  try {
    await client.pushMessage(userId, { type: "text", text });
  } catch (e) {
    console.log("push error", e);
  }
};

// ===== Google =====
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.SPREADSHEET_ID;

// ===== 固定 =====
const OWNER_ID = "U1a1aca9e44466f8cb05003d7dc86fee0";
const ADMIN_PASS = "1234";

// ===== メンション取得 =====
function getMention(event) {
  const m = event.message.mention;
  if (!m || !m.mentionees?.length) return null;
  return m.mentionees[0].userId;
}

// ===== 設定 =====
async function getSettings(groupId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "settings!A:C"
  });
  const rows = res.data.values || [];
  return rows.reverse().find(r => r[0] === groupId);
}

async function ensureSettings(groupId) {
  if (!(await getSettings(groupId))) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "settings!A:C",
      valueInputOption: "RAW",
      requestBody: { values: [[groupId, "5", "ON"]] }
    });
  }
}

// ===== 管理 =====
async function isAdmin(groupId, userId) {
  if (userId === OWNER_ID) return true;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "admins!A:B"
  });

  const rows = res.data.values || [];
  return rows.some(r => r[0] === groupId && r[1] === userId);
}

// ===== 副管理 =====
async function isSub(groupId, userId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "subs!A:B"
  });

  const rows = res.data.values || [];
  return rows.some(r => r[0] === groupId && r[1] === userId);
}

function isManager(groupId, userId) {
  return isAdmin(groupId, userId) || isSub(groupId, userId);
}

// ===== NG =====
async function getNG(groupId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "ng!A:B"
  });
  const rows = res.data.values || [];
  return rows.filter(r => r[0] === groupId);
}

async function addNG(groupId, word) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "ng!A:B",
    valueInputOption: "RAW",
    requestBody: { values: [[groupId, word]] }
  });
}

// ===== UI（2列）=====
const menuFlex = {
  type: "flex",
  altText: "管理メニュー",
  contents: {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [

        {
          type: "box",
          layout: "vertical",
          backgroundColor: "#0D47A1",
          paddingAll: "12px",
          contents: [
            {
              type: "text",
              text: "管理メニュー",
              color: "#FFFFFF",
              weight: "bold",
              align: "center"
            }
          ]
        },

        // ===== 2列 =====
        {
          type: "box",
          layout: "horizontal",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "primary",
              color: "#1565C0",
              action: { type: "message", label: "管理登録", text: "管理登録 1234" }
            },
            {
              type: "button",
              style: "primary",
              color: "#1565C0",
              action: { type: "message", label: "副管理追加", text: "副管理追加 @" }
            }
          ]
        },

        {
          type: "box",
          layout: "horizontal",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "primary",
              color: "#D32F2F",
              action: { type: "message", label: "NG追加", text: "NG追加 test" }
            },
            {
              type: "button",
              style: "primary",
              color: "#1565C0",
              action: { type: "message", label: "NG一覧", text: "NG一覧" }
            }
          ]
        },

        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "button",
              style: "primary",
              color: "#1565C0",
              action: { type: "message", label: "状態確認", text: "状態確認" }
            },
            {
              type: "button",
              style: "primary",
              color: "#1565C0",
              action: { type: "message", label: "連投制限", text: "連投制限 5" }
            }
          ]
        },

        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "button",
              style: "secondary",
              color: "#212121",
              action: { type: "message", label: "挨拶ON", text: "挨拶ON" }
            },
            {
              type: "button",
              style: "secondary",
              color: "#424242",
              action: { type: "message", label: "挨拶OFF", text: "挨拶OFF" }
            }
          ]
        }

      ]
    }
  }
};

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req, res) => {

  for (const event of req.body.events) {

    if (!event.source.groupId) continue;

    const groupId = event.source.groupId;
    const userId = event.source.userId;

    await ensureSettings(groupId);
    const setting = await getSettings(groupId);

    if (event.type !== "message") continue;
    if (event.message.type !== "text") continue;

    const text = event.message.text.trim();

    // ===== menu =====
    if (text === "menu") {
      await client.replyMessage(event.replyToken, menuFlex);
      continue;
    }

    // ===== 管理登録 =====
    if (text.startsWith("管理登録")) {
      const pass = text.replace("管理登録","").trim();
      if (pass !== ADMIN_PASS) {
        await push(userId,"パス違い");
        continue;
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "admins!A:C",
        valueInputOption: "RAW",
        requestBody: { values: [[groupId, userId, "管理者"]] }
      });

      await push(userId,"管理者登録OK");
      continue;
    }

    // ===== 副管理追加 =====
    if (text.startsWith("副管理追加")) {

      if (!(await isAdmin(groupId, userId))) {
        await push(userId,"管理者のみ");
        continue;
      }

      const target = getMention(event);
      if (!target) {
        await push(userId,"メンションして");
        continue;
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "subs!A:B",
        valueInputOption: "RAW",
        requestBody: { values: [[groupId, target]] }
      });

      await push(userId,"副管理追加OK");
      continue;
    }

    // ===== NG追加 =====
    if (text.startsWith("NG追加")) {

      if (!(await isAdmin(groupId, userId))) {
        await push(userId,"権限なし");
        continue;
      }

      const word = text.replace("NG追加","").trim();
      if (!word) {
        await push(userId,"入力して");
        continue;
      }

      await addNG(groupId, word);
      await push(userId,"NG追加OK");
      continue;
    }

    // ===== NG一覧 =====
    if (text === "NG一覧") {
      const list = (await getNG(groupId)).map(r => r[1]);
      await push(userId, list.join("\n") || "なし");
      continue;
    }

    // ===== 状態 =====
    if (text === "状態確認") {
      await push(userId, `制限:${setting?.[1]}\n挨拶:${setting?.[2]}`);
      continue;
    }

    // ===== 連投 =====
    if (text.startsWith("連投制限")) {
      const num = text.replace("連投制限","").trim();

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "settings!A:C",
        valueInputOption: "RAW",
        requestBody: { values: [[groupId, num, setting?.[2]]] }
      });

      await push(userId,"設定OK");
      continue;
    }

    // ===== 挨拶 =====
    if (text === "挨拶ON") {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "settings!A:C",
        valueInputOption: "RAW",
        requestBody: { values: [[groupId, setting?.[1], "ON"]] }
      });

      await push(userId,"ON");
      continue;
    }

    if (text === "挨拶OFF") {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "settings!A:C",
        valueInputOption: "RAW",
        requestBody: { values: [[groupId, setting?.[1], "OFF"]] }
      });

      await push(userId,"OFF");
      continue;
    }

  }

  res.sendStatus(200);
});

app.listen(3000);
