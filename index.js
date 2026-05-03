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

// ===== reply安全化 =====
const safeReply = async (event, messages) => {
  try {
    await client.replyMessage(event.replyToken, messages);
  } catch (e) {
    // 期限切れなど → pushでフォールバック
    try {
      const userId = event.source?.userId;
      if (userId) {
        await client.pushMessage(userId, messages);
      }
    } catch (e2) {
      console.log("reply/push error", e2);
    }
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

// ===== ユーティリティ =====
const toRows = (res) => res.data.values || [];
const lastRowByGroup = (rows, groupId) =>
  rows.slice().reverse().find(r => r[0] === groupId);

const getMention = (event) => {
  const m = event.message.mention;
  if (!m || !m.mentionees?.length) return null;
  return m.mentionees[0].userId;
};

// ===== settings（append前提で最後の行を採用）=====
async function getSettings(groupId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "settings!A:D"
  });
  const rows = toRows(res);
  return lastRowByGroup(rows, groupId);
}

async function ensureSettings(groupId) {
  const s = await getSettings(groupId);
  if (!s) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "settings!A:D",
      valueInputOption: "RAW",
      requestBody: { values: [[groupId, "5", "ON", "ようこそ！"]] }
    });
  }
}

async function appendSettings(groupId, limit, greet, greetText) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "settings!A:D",
    valueInputOption: "RAW",
    requestBody: { values: [[groupId, String(limit), greet, greetText || ""]] }
  });
}

// ===== 管理 =====
async function getAdmins() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "admins!A:C"
  });
  return toRows(res);
}

async function isAdmin(groupId, userId) {
  if (userId === OWNER_ID) return true;
  const rows = await getAdmins();
  return rows.some(r => r[0] === groupId && r[1] === userId);
}

async function getSubs() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "subs!A:B"
  });
  return toRows(res);
}

async function isSub(groupId, userId) {
  const rows = await getSubs();
  return rows.some(r => r[0] === groupId && r[1] === userId);
}

async function isManager(groupId, userId) {
  return (await isAdmin(groupId, userId)) || (await isSub(groupId, userId));
}

async function addAdmin(groupId, userId, name = "管理者") {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "admins!A:C",
    valueInputOption: "RAW",
    requestBody: { values: [[groupId, userId, name]] }
  });
}

async function removeAdmin(groupId, targetId) {
  const rows = await getAdmins();
  const filtered = rows.filter(r => !(r[0] === groupId && r[1] === targetId));
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "admins!A:C"
  });
  if (filtered.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "admins!A:C",
      valueInputOption: "RAW",
      requestBody: { values: filtered }
    });
  }
}

async function addSub(groupId, userId) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "subs!A:B",
    valueInputOption: "RAW",
    requestBody: { values: [[groupId, userId]] }
  });
}

async function removeSub(groupId, targetId) {
  const rows = await getSubs();
  const filtered = rows.filter(r => !(r[0] === groupId && r[1] === targetId));
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "subs!A:B"
  });
  if (filtered.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "subs!A:B",
      valueInputOption: "RAW",
      requestBody: { values: filtered }
    });
  }
}

// ===== NG =====
async function getNG(groupId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "ng!A:B"
  });
  const rows = toRows(res);
  return rows.filter(r => r[0] === groupId).map(r => r[1]);
}

async function addNG(groupId, word) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "ng!A:B",
    valueInputOption: "RAW",
    requestBody: { values: [[groupId, word]] }
  });
}

async function removeNG(groupId, word) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "ng!A:B"
  });
  const rows = toRows(res);
  const filtered = rows.filter(r => !(r[0] === groupId && r[1] === word));
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "ng!A:B"
  });
  if (filtered.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "ng!A:B",
      valueInputOption: "RAW",
      requestBody: { values: filtered }
    });
  }
}

// ===== UI（2列・黒は白文字）=====
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
            { type: "text", text: "管理メニュー", color: "#FFFFFF", weight: "bold", align: "center", size: "lg" }
          ]
        },

        // 管理
        {
          type: "box", layout: "horizontal", spacing: "sm", contents: [
            { type: "button", style: "primary", color: "#1565C0", action: { type: "message", label: "管理登録", text: "管理登録 1234" } },
            { type: "button", style: "primary", color: "#1565C0", action: { type: "message", label: "管理一覧", text: "管理一覧" } }
          ]
        },
        {
          type: "box", layout: "horizontal", spacing: "sm", contents: [
            { type: "button", style: "primary", color: "#1565C0", action: { type: "message", label: "管理削除", text: "管理削除 @" } },
            { type: "button", style: "primary", color: "#1565C0", action: { type: "message", label: "副管理一覧", text: "副管理一覧" } }
          ]
        },
        {
          type: "box", layout: "horizontal", spacing: "sm", contents: [
            { type: "button", style: "primary", color: "#1565C0", action: { type: "message", label: "副管理追加", text: "副管理追加 @" } },
            { type: "button", style: "primary", color: "#1565C0", action: { type: "message", label: "副管理削除", text: "副管理削除 @" } }
          ]
        },

        // NG
        {
          type: "box", layout: "horizontal", spacing: "sm", contents: [
            { type: "button", style: "primary", color: "#D32F2F", action: { type: "message", label: "NG追加", text: "NG追加 test" } },
            { type: "button", style: "primary", color: "#1565C0", action: { type: "message", label: "NG一覧", text: "NG一覧" } }
          ]
        },
        {
          type: "box", layout: "horizontal", spacing: "sm", contents: [
            { type: "button", style: "primary", color: "#1565C0", action: { type: "message", label: "NG削除", text: "NG削除 test" } },
            { type: "button", style: "primary", color: "#1565C0", action: { type: "message", label: "状態確認", text: "状態確認" } }
          ]
        },

        // 連投
        {
          type: "box", layout: "horizontal", contents: [
            { type: "button", style: "primary", color: "#1565C0", action: { type: "message", label: "連投制限", text: "連投制限 5" } },
            { type: "button", style: "primary", color: "#1565C0", action: { type: "message", label: "設定確認", text: "状態確認" } }
          ]
        },

        // 挨拶（黒→白文字）
        {
          type: "box", layout: "horizontal", contents: [
            { type: "button", style: "secondary", color: "#212121", action: { type: "message", label: "挨拶ON", text: "挨拶ON" } },
            { type: "button", style: "secondary", color: "#424242", action: { type: "message", label: "挨拶OFF", text: "挨拶OFF" } }
          ]
        },
        {
          type: "box", layout: "horizontal", contents: [
            { type: "button", style: "primary", color: "#1565C0", action: { type: "message", label: "挨拶登録", text: "挨拶登録 ようこそ！" } },
            { type: "button", style: "primary", color: "#1565C0", action: { type: "message", label: "挨拶確認", text: "挨拶確認" } }
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
    const setting = await getSettings(groupId); // [groupId, limit, greet, greetText]

    if (event.type === "memberJoined") {
      // 入室時挨拶
      if (setting?.[2] === "ON") {
        const text = setting?.[3] || "ようこそ！";
        await safeReply(event, { type: "text", text });
      }
      continue;
    }

    if (event.type !== "message" || event.message.type !== "text") continue;

    const text = event.message.text.trim();

    // ===== menu =====
    if (text === "menu") {
      await safeReply(event, menuFlex);
      continue;
    }

    // ===== 管理登録 =====
    if (text.startsWith("管理登録")) {
      const pass = text.replace("管理登録","").trim();
      if (pass !== ADMIN_PASS) {
        await safeReply(event, { type: "text", text: "パス違い" });
        continue;
      }
      await addAdmin(groupId, userId, "管理者");
      await safeReply(event, { type: "text", text: "管理者登録OK" });
      continue;
    }

    // ===== 管理一覧 =====
    if (text === "管理一覧") {
      const rows = await getAdmins();
      const list = rows
        .filter(r => r[0] === groupId)
        .map(r => r[1]);
      await safeReply(event, { type: "text", text: list.join("\n") || "なし" });
      continue;
    }

    // ===== 管理削除 =====
    if (text.startsWith("管理削除")) {
      if (!(await isAdmin(groupId, userId))) {
        await safeReply(event, { type: "text", text: "管理者のみ" });
        continue;
      }
      const target = getMention(event);
      if (!target) {
        await safeReply(event, { type: "text", text: "メンションして" });
        continue;
      }
      if (target === OWNER_ID) {
        await safeReply(event, { type: "text", text: "オーナー削除不可" });
        continue;
      }
      await removeAdmin(groupId, target);
      await safeReply(event, { type: "text", text: "管理削除OK" });
      continue;
    }

    // ===== 副管理追加 =====
    if (text.startsWith("副管理追加")) {
      if (!(await isAdmin(groupId, userId))) {
        await safeReply(event, { type: "text", text: "管理者のみ" });
        continue;
      }
      const target = getMention(event);
      if (!target) {
        await safeReply(event, { type: "text", text: "メンションして" });
        continue;
      }
      await addSub(groupId, target);
      await safeReply(event, { type: "text", text: "副管理追加OK" });
      continue;
    }

    // ===== 副管理一覧 =====
    if (text === "副管理一覧") {
      const rows = await getSubs();
      const list = rows.filter(r => r[0] === groupId).map(r => r[1]);
      await safeReply(event, { type: "text", text: list.join("\n") || "なし" });
      continue;
    }

    // ===== 副管理削除 =====
    if (text.startsWith("副管理削除")) {
      if (!(await isAdmin(groupId, userId))) {
        await safeReply(event, { type: "text", text: "管理者のみ" });
        continue;
      }
      const target = getMention(event);
      if (!target) {
        await safeReply(event, { type: "text", text: "メンションして" });
        continue;
      }
      await removeSub(groupId, target);
      await safeReply(event, { type: "text", text: "副管理削除OK" });
      continue;
    }

    // ===== NG追加 =====
    if (text.startsWith("NG追加")) {
      if (!(await isAdmin(groupId, userId))) {
        await safeReply(event, { type: "text", text: "権限なし" });
        continue;
      }
      const word = text.replace("NG追加","").trim();
      if (!word) {
        await safeReply(event, { type: "text", text: "入力して" });
        continue;
      }
      await addNG(groupId, word);
      await safeReply(event, { type: "text", text: "NG追加OK" });
      continue;
    }

    // ===== NG一覧 =====
    if (text === "NG一覧") {
      const list = await getNG(groupId);
      await safeReply(event, { type: "text", text: list.join("\n") || "なし" });
      continue;
    }

    // ===== NG削除 =====
    if (text.startsWith("NG削除")) {
      if (!(await isAdmin(groupId, userId))) {
        await safeReply(event, { type: "text", text: "権限なし" });
        continue;
      }
      const word = text.replace("NG削除","").trim();
      if (!word) {
        await safeReply(event, { type: "text", text: "入力して" });
        continue;
      }
      await removeNG(groupId, word);
      await safeReply(event, { type: "text", text: "NG削除OK" });
      continue;
    }

    // ===== 状態確認 =====
    if (text === "状態確認") {
      await safeReply(event, {
        type: "text",
        text: `制限:${setting?.[1]}\n挨拶:${setting?.[2]}`
      });
      continue;
    }

    // ===== 連投制限 =====
    if (text.startsWith("連投制限")) {
      if (!(await isManager(groupId, userId))) {
        await safeReply(event, { type: "text", text: "権限なし" });
        continue;
      }
      const num = text.replace("連投制限","").trim();
      const limit = Number(num) || 5;
      await appendSettings(groupId, limit, setting?.[2] || "ON", setting?.[3] || "");
      await safeReply(event, { type: "text", text: "設定OK" });
      continue;
    }

    // ===== 挨拶ON/OFF =====
    if (text === "挨拶ON") {
      await appendSettings(groupId, setting?.[1] || "5", "ON", setting?.[3] || "");
      await safeReply(event, { type: "text", text: "ON" });
      continue;
    }

    if (text === "挨拶OFF") {
      await appendSettings(groupId, setting?.[1] || "5", "OFF", setting?.[3] || "");
      await safeReply(event, { type: "text", text: "OFF" });
      continue;
    }

    // ===== 挨拶登録 =====
    if (text.startsWith("挨拶登録")) {
      if (!(await isAdmin(groupId, userId))) {
        await safeReply(event, { type: "text", text: "権限なし" });
        continue;
      }
      const greetText = text.replace("挨拶登録","").trim();
      if (!greetText) {
        await safeReply(event, { type: "text", text: "内容入れて" });
        continue;
      }
      await appendSettings(groupId, setting?.[1] || "5", setting?.[2] || "ON", greetText);
      await safeReply(event, { type: "text", text: "挨拶登録OK" });
      continue;
    }

    // ===== 挨拶確認 =====
    if (text === "挨拶確認") {
      const greetText = setting?.[3] || "未設定";
      await safeReply(event, {
        type: "text",
        text: `状態:${setting?.[2]}\n内容:${greetText}`
      });
      continue;
    }

  }

  res.sendStatus(200);
});

app.listen(3000);
