// Группа: команды копилки, реакции на сообщения, крон-задачи, веб-сервер.
// Пихал Малыч: тетрадка шуток чата + реакции + шутка дня.
// Хостинг — Supabase Edge Functions.
// ВАЖНО: реакции на обычные сообщения требуют ВЫКЛЮЧЕННОГО privacy mode у бота
// (@BotFather → Group Privacy → Turn off) + переподключения бота в группу.

import { Bot, InlineKeyboard, InputFile, Keyboard, webhookCallback } from "https://esm.sh/grammy@1.30.0";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding@1/base64";
import { LN, ON } from "./config.ts";
import { DELETERS_TEXT, LINK_SUSPECT_TEXT, PREDICT_EXCLUDE_LIST } from "./config.ts";
import { COMMENT_SYSTEM, CRON_SECRET, GEMINI_KEY, HELP, HERE_PHRASES, HTML, LENYA, LINK_PHRASE, LINK_SUSPECTS, MAX_LEN, PAGE_SIZE, PING_PHRASES, PRAISES, PREDICT_SCHEMA, PREDICT_SYSTEM, REFUSE_POLITE, REFUSE_RUDE, ROAST_FALLBACK, ROAST_SYSTEM, SNAP_REACT_PROB, SUPER_OWNER, assistantCore, attachContext, background, bot, botMsgKind, buildDossier, commandLike, esc, fmtDate, geminiText, getFlag, hasLink, inlineJokeText, isDeleter, isFormal, isOwner, isPlaceTarget, isProtected, isReplyToBot, jokeKeyboard, judgeCore, makeReactionSnap, makeSnap, mentionsBot, nightSkip, ownerToggle, pick, pickPlacePhrase, reactionKey, reactionLabel, sendTalk, setFlag, snapCore, spamCheck, spamWarn, supabase, trunc, uname } from "./core.ts";
import { isPaOwner, paHandle, paOnLocation, processReminders, sendPaEvening, sendPaSummary, sendPaWeekly } from "./assistant.ts";

// --- /list (сквозная нумерация + пагинация) ---
export async function renderList(page: number): Promise<{ text: string; kb?: InlineKeyboard }> {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, count, error } = await supabase
    .from("jokes").select("id, text, likes, dislikes, context", { count: "exact" })
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(from, to);
  if (error) return { text: "Ошибка при загрузке 😬" };
  const total = count ?? 0;
  if (total === 0) return { text: "Пока пусто. Добавь шутку: /add ..." };
  const pages = Math.ceil(total / PAGE_SIZE);
  const anyCtx = (data ?? []).some((j) => !!j.context);
  const header = `<b>📓 Тетрадка Пихал Малыча</b>\n<i>стр. ${page + 1}/${pages} · всего ${total}${anyCtx ? " · 📖 = есть контекст" : ""}</i>`;
  const lines = (data ?? []).map(
    (j, idx) => `<b>${from + idx + 1}.</b> ${esc(j.text)}\n    👍 ${j.likes}  👎 ${j.dislikes}${j.context ? "  📖" : ""}`,
  );
  const text = header + "\n\n" + lines.join("\n\n");
  // кнопки-номера: нажал — бот прислал эту шутку (с лайками и контекстом); по 5 в ряд
  const kb = new InlineKeyboard();
  (data ?? []).forEach((j, idx) => {
    kb.text(`${from + idx + 1}${j.context ? "📖" : ""}`, `open:${j.id}`);
    if (idx % 5 === 4) kb.row();
  });
  kb.row();
  if (page > 0) kb.text("◀️ Назад", `list:${page - 1}`);
  if (page < pages - 1) kb.text("Вперёд ▶️", `list:${page + 1}`);
  return { text, kb };
}

// --- админка: список «на место» (владельцы; удобнее всего в личке с ботом) ---
export async function renderPlaceList(): Promise<{ text: string; kb?: InlineKeyboard }> {
  const { data } = await supabase
    .from("place_targets").select("username").order("created_at", { ascending: true });
  const list = data ?? [];
  const placeOn = await getFlag("lenya_place", true);
  let text = `<b>🐕 Админка — кого посылать «на место»</b>\n` +
    `<i>реакция сейчас: ${placeOn ? "✅ вкл" : "🚫 выкл"} (рубильник /mesto)</i>\n\n`;
  if (list.length === 0) {
    text += "<i>Список пуст — никого не посылаю.</i>";
  } else {
    text += list.map((r, i) => `${i + 1}. @${esc(r.username)}`).join("\n");
  }
  text += "\n\n➕ Добавить: <code>/place add @ник</code>\n" +
    "➖ Убрать: кнопкой ниже или <code>/place del @ник</code>\n" +
    "💬 Фразы посылания: /phrases";
  const kb = new InlineKeyboard();
  for (const r of list) kb.text(`❌ @${r.username}`, `placedel:${r.username}`).row();
  return { text, kb: kb.inline_keyboard.length > 0 ? kb : undefined };
}

// --- варианты фраз «на место» (владельцы) ---
export async function renderPhraseList(): Promise<{ text: string; kb?: InlineKeyboard }> {
  const { data } = await supabase
    .from("place_phrases").select("id, text").order("created_at", { ascending: true }).order("id", { ascending: true });
  const list = data ?? [];
  let text = "<b>💬 Фразы «на место»</b>\n<i>бот выбирает случайную из них</i>\n\n";
  if (list.length === 0) {
    text += "<i>Список пуст — временно использую встроенные фразы.</i>";
  } else {
    text += list.map((r, i) => `${i + 1}. ${esc(r.text)}`).join("\n");
  }
  text += "\n\n➕ Добавить: <code>/phrases add текст</code>\n" +
    "➖ Убрать: кнопкой ниже или <code>/phrases del номер</code>\n" +
    "💡 В тексте можно <code>{name}</code> — подставит имя того, кого послали.";
  const kb = new InlineKeyboard();
  for (const r of list) kb.text(`❌ ${trunc(r.text, 24)}`, `phrdel:${r.id}`).row();
  return { text, kb: kb.inline_keyboard.length > 0 ? kb : undefined };
}

// --- управление админами (владельцы) ---
export async function renderOwnerList(): Promise<{ text: string; kb?: InlineKeyboard }> {
  const { data } = await supabase
    .from("owners").select("username").order("created_at", { ascending: true });
  const extra = data ?? [];
  let text = "<b>👑 Админы бота</b>\n\n" +
    `1. @${esc(SUPER_OWNER)} <i>(главный, снять нельзя)</i>`;
  extra.forEach((r, i) => { text += `\n${i + 2}. @${esc(r.username)}`; });
  text += "\n\n➕ Назначить: <code>/owners add @ник</code>\n" +
    "➖ Снять: кнопкой ниже или <code>/owners del @ник</code>\n" +
    "<i>Админы рулят всеми настройками и могут удалять шутки.</i>";
  const kb = new InlineKeyboard();
  for (const r of extra) kb.text(`❌ @${r.username}`, `ownerdel:${r.username}`).row();
  return { text, kb: kb.inline_keyboard.length > 0 ? kb : undefined };
}

// --- шутка дня (вызывается по cron'у) ---
export async function sendDailyJoke() {
  await sendJokeOfDay();
  // предсказания — по журналу, поэтому до его чистки
  if (await getFlag("predict", true)) {
    const { data: chats } = await supabase.from("broadcast_chats").select("chat_id");
    for (const c of chats ?? []) {
      try {
        await sendPredictions(c.chat_id);
      } catch (e) {
        console.error("predict failed for", c.chat_id, e);
      }
    }
  }
  // заодно чистим журналы: сообщения чата старше 3 дней, свои сообщения старше 30 дней
  await supabase.from("chat_log").delete().lt("created_at", new Date(Date.now() - 3 * 864e5).toISOString());
  await supabase.from("bot_messages").delete().lt("created_at", new Date(Date.now() - 30 * 864e5).toISOString());
  await supabase.from("counters").delete().like("key", "rsnap:%").lt("n", Math.floor(Date.now() / 1000) - 86400);
  { // счётчики «огрызов на реакции за день» старше вчерашнего
    const y = new Date(Date.now() + 5 * 3600e3 - 864e5).toISOString().slice(0, 10).replace(/-/g, "");
    const { data: old } = await supabase.from("counters").select("key").like("key", "rday:%").limit(1000);
    const stale = (old ?? []).map((x) => x.key).filter((k: string) => k.split(":")[3] < y);
    if (stale.length) await supabase.from("counters").delete().in("key", stale);
  }
  await supabase.from("spam_guard").delete().lt("window_start", new Date(Date.now() - 864e5).toISOString());
}

// шутка дня с комментарием
export async function sendJokeOfDay() {
  const { data } = await supabase.rpc("get_random_joke");
  if (!data || data.length === 0) return;
  const j = data[0];
  const { data: chats } = await supabase.from("broadcast_chats").select("chat_id");
  // злобный комментарий от Gemini (если не ответила — шутка уходит без него)
  const comment = await geminiText(COMMENT_SYSTEM, [{ text: `Шутка дня: «${j.text}»\nАвтор: ${j.added_by ?? "аноним"}` }], {
    temperature: 1.1, maxTokens: 200, maxChars: 250, deadlineMs: 40_000,
  });
  const text = `🗓 <b>Шутка дня из тетрадки</b>\n\n😄 ${esc(j.text)}` + (comment ? `\n\n💬 <i>${esc(comment)}</i>` : "");
  for (const c of chats ?? []) {
    try {
      await bot.api.sendMessage(c.chat_id, text, {
        ...HTML,
        reply_markup: jokeKeyboard(j.id, j.likes, j.dislikes, !!j.context),
      });
    } catch (e) {
      console.error("daily send failed for", c.chat_id, e);
    }
  }
}

// кого не включать в предсказания (ники в нижнем регистре, без @)
export const PREDICT_EXCLUDE = new Set(PREDICT_EXCLUDE_LIST);

// предсказание дня: каждому, кто писал в чат за последние 3 дня (до 15 человек), с тегом
export async function sendPredictions(chatId: number) {
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  const { data: rows } = await supabase.from("chat_log").select("user_id, username, user_name, text")
    .eq("chat_id", chatId).not("user_id", "is", null).gte("created_at", since)
    .order("id", { ascending: false }).limit(600);
  // deno-lint-ignore no-explicit-any
  const people = new Map<number, { name: string; username: string | null; lines: string[] }>();
  for (const r of rows ?? []) {
    const id = Number(r.user_id);
    if (PREDICT_EXCLUDE.has(String(r.username ?? "").toLowerCase())) continue; // исключены
    if (!people.has(id)) people.set(id, { name: r.user_name, username: r.username, lines: [] });
    const p = people.get(id)!;
    if (p.lines.length < 5) p.lines.push(trunc(r.text, 120));
  }
  const list = [...people.entries()].slice(0, 15);
  if (list.length === 0) return;
  const prompt = list.map(([, p], i) => `${i + 1}. ${p.name}: ${p.lines.join(" | ")}`).join("\n");
  const raw = await geminiText(PREDICT_SYSTEM, [{ text: prompt }], {
    json: PREDICT_SCHEMA, temperature: 1.1, maxTokens: 2500, deadlineMs: 60_000, timeoutMs: 30_000,
  });
  const texts = new Map<number, string>();
  try {
    // deno-lint-ignore no-explicit-any
    for (const it of JSON.parse(raw ?? "{}").items ?? []) texts.set(Number(it.n), String(it.text ?? "").trim());
  } catch { /* нет ответа — пропускаем день */ }
  if (texts.size === 0) return;
  const out = list.map(([id, p], i) => {
    const t = texts.get(i + 1);
    if (!t) return "";
    const tag = p.username ? `@${esc(p.username)}` : `<a href="tg://user?id=${id}">${esc(p.name)}</a>`;
    return `${tag} — ${esc(t)}`;
  }).filter(Boolean);
  if (out.length === 0) return;
  await bot.api.sendMessage(chatId, `🔮 <b>Предсказания на сегодня</b>\n\n${out.join("\n\n")}`, HTML);
}

// --- шутник недели (вызывается по cron'у) ---
export async function sendWeeklyDigest() {
  const { data: authors } = await supabase.rpc("weekly_top_authors");
  const { data: best } = await supabase.rpc("weekly_top_joke");
  const { data: chats } = await supabase.from("broadcast_chats").select("chat_id");

  let body: string;
  const hasAuthors = authors && authors.length > 0;
  const hasBest = best && best.length > 0;
  if (!hasAuthors && !hasBest) {
    body = "🏆 <b>Итоги недели</b>\n\nНа этой неделе в тетрадку ничего не записали 🤷 Исправляйтесь!";
  } else {
    body = "🏆 <b>Итоги недели по тетрадке Малыча</b>";
    if (hasAuthors) {
      const a = authors[0];
      body += `\n\n👑 <b>Шутник недели:</b> ${esc(a.author)} — ${a.jokes} шт., 👍 ${a.likes}`;
    }
    if (hasBest) {
      const b = best[0];
      body += `\n\n🥇 <b>Лучшая шутка недели</b> <i>(👍 ${b.likes} · ${esc(b.jauthor)})</i>:\n😄 ${esc(b.jtext)}`;
    }
  }
  for (const c of chats ?? []) {
    try {
      await bot.api.sendMessage(c.chat_id, body, HTML);
    } catch (e) {
      console.error("weekly send failed for", c.chat_id, e);
    }
  }
}

// --- пинг «герой, ты тут?» (вызывается по cron'у каждый час окна 09–20 UTC) ---
// Гарантируем ровно ОДИН пинг за день в случайный час: на каждом тике пингуем
// с вероятностью 1/(осталось часов до конца окна) — равномерно по окну.
export async function sendLenyaPing(force = false) {
  if (!force && !(await getFlag("lenya_ping", true))) return;
  const now = new Date();
  const h = now.getUTCHours();
  const today = now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  if (!force) {
    if (h < 9 || h > 20) return; // вне окна 09–20 UTC (14:00–01:00 по Ашхабаду) — молчим
    const { data: g } = await supabase.from("counters").select("n").eq("key", "lenya_ping_day").maybeSingle();
    if (g && Number(g.n) === today) return; // сегодня уже пингнули
    const remaining = 21 - h; // тиков до конца окна включительно
    if (Math.random() >= 1 / remaining) return; // в этот час — мимо
  }
  const { data: chats } = await supabase.from("broadcast_chats").select("chat_id");
  if (!chats || chats.length === 0) return; // некуда слать
  await supabase.from("counters").upsert({ key: "lenya_ping_day", n: today }); // фиксируем «пингнули сегодня»
  await setFlag("lenya_waiting", true); // ждём ответа герой
  const text = pick(PING_PHRASES).replace(/\{tag\}/g, "@" + LENYA);
  for (const c of chats) {
    try {
      await sendTalk("talk", c.chat_id, text);
    } catch (e) {
      console.error("ping send failed for", c.chat_id, e);
    }
  }
}

// --- тест ответа «он тут»: шлёт случайную HERE_PHRASES во все чаты и снимает ожидание ---
export async function sendHereTest() {
  await setFlag("lenya_waiting", false);
  const { data: chats } = await supabase.from("broadcast_chats").select("chat_id");
  const text = pick(HERE_PHRASES);
  for (const c of chats ?? []) {
    try {
      await sendTalk("talk", c.chat_id, text);
    } catch (e) {
      console.error("here-test send failed for", c.chat_id, e);
    }
  }
}

// --- перепривязать вебхук, добавив в allowed_updates реакции (иначе Telegram их не шлёт) ---
export async function setupWebhook(): Promise<unknown> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/bot`;
  await bot.api.setWebhook(url, {
    secret_token: Deno.env.get("TELEGRAM_WEBHOOK_SECRET"),
    allowed_updates: [
      "message", "edited_message", "channel_post", "edited_channel_post", "inline_query",
      "chosen_inline_result", "callback_query", "my_chat_member", "chat_join_request", "message_reaction",
    ],
  });
  return await bot.api.getWebhookInfo();
}

export const handleUpdate = webhookCallback(bot, "std/http", {
  secretToken: Deno.env.get("TELEGRAM_WEBHOOK_SECRET"),
});

// регистрация обработчиков — вызывается из index.ts строго по порядку: core → assistant → group
export function registerGroup() {
  // --- /start /help ---
  bot.command(["start", "help"], (ctx) => ctx.reply(HELP, HTML));

  // --- /add ---
  bot.command("add", async (ctx) => {
    const text = ctx.match?.trim();
    if (!text) {
      await ctx.reply(`Напиши шутку после команды, например:\n/add ${LN.nom} снова проспал работу`);
      return;
    }
    if (text.length > MAX_LEN) {
      await ctx.reply(`Слишком длинно 🙏 Давай покороче (до ${MAX_LEN} символов).`);
      return;
    }
    if (uname(ctx) === LENYA && !(await getFlag("lenya_can_add"))) {
      await ctx.reply(`${LN.nom}, тебе пока нельзя добавлять шутки про себя 😏\nПусть админ разрешит: /lenya on`);
      return;
    }
    const { data: dup } = await supabase.from("jokes").select("id").ilike("text", text).limit(1);
    if (dup && dup.length > 0) {
      await ctx.reply("Такая шутка уже есть в копилке 👀");
      return;
    }
    const author = ctx.from?.first_name ?? "аноним";
    const { data: ins, error } = await supabase.from("jokes").insert({ text, added_by: author }).select("id").single();
    if (error || !ins) {
      console.error(error);
      await ctx.reply("Ой, не смог сохранить 😬 Попробуй ещё раз.");
      return;
    }
    const sent = await ctx.reply("Записал в копилку 📓");
    // в фоне: ищем в последних сообщениях чата, к чему эта шутка; если нашли — сохраняем и вешаем кнопку
    await background(attachContext(ctx.chat.id, ctx.msg.message_id, ins.id, text, sent.message_id));
  });

  // --- кнопка «📖 Контекст» — показать, из-за чего появилась шутка ---
  bot.callbackQuery(/^ctx:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    const { data } = await supabase.from("jokes").select("context").eq("id", id).maybeSingle();
    if (!data?.context) {
      await ctx.answerCallbackQuery("Контекста нет 🤷");
      return;
    }
    const msgId = ctx.callbackQuery.message?.message_id;
    if (ctx.chat && msgId) {
      await bot.api.sendMessage(ctx.chat.id, `📖 <b>Контекст</b>\n\n${esc(data.context)}`, {
        ...HTML, reply_parameters: { message_id: msgId },
      });
      await ctx.answerCallbackQuery();
    } else {
      await ctx.answerCallbackQuery({ text: trunc(data.context, 200), show_alert: true });
    }
  });

  // --- /joke [номер] — случайная или конкретная по номеру из /list ---
  bot.command("joke", async (ctx) => {
    const arg = (ctx.match ?? "").trim();
    // deno-lint-ignore no-explicit-any
    let j: any;
    if (arg) {
      const pos = Number(arg);
      if (!Number.isInteger(pos) || pos <= 0) {
        await ctx.reply("Номер должен быть числом. Пример: /joke 3\nИли просто /joke — случайная.");
        return;
      }
      // та же нумерация, что в /list: новые сверху, позиция pos
      const { data, error } = await supabase
        .from("jokes")
        .select("id, text, added_by, created_at, likes, dislikes, context")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(pos - 1, pos - 1);
      if (error) {
        await ctx.reply("Ошибка 😬");
        return;
      }
      if (!data || data.length === 0) {
        await ctx.reply(`Шутки №${pos} нет. Глянь список: /list`);
        return;
      }
      j = data[0];
    } else {
      const { data, error } = await supabase.rpc("get_random_joke");
      if (error || !data || data.length === 0) {
        await ctx.reply("Копилка пока пустая. Добавь первую: /add ...");
        return;
      }
      j = data[0];
    }
    const text = `😄 ${esc(j.text)}\n\n<i>👤 ${esc(j.added_by ?? "аноним")} · 🗓 ${fmtDate(j.created_at)}</i>`;
    await ctx.reply(text, { ...HTML, reply_markup: jokeKeyboard(j.id, j.likes, j.dislikes, !!j.context) });
  });

  // --- /top ---
  bot.command("top", async (ctx) => {
    const { data, error } = await supabase
      .from("jokes").select("text, likes")
      .order("likes", { ascending: false }).order("created_at", { ascending: true })
      .limit(10);
    if (error || !data || data.length === 0) {
      await ctx.reply("Пока пусто. Добавь шутку: /add ...");
      return;
    }
    const medals = ["🥇", "🥈", "🥉"];
    const lines = data.map((j, i) => `${medals[i] ?? `${i + 1}.`} ${esc(j.text)}  <i>(👍 ${j.likes})</i>`);
    await ctx.reply("<b>🏆 Топ из тетрадки Малыча</b>\n\n" + lines.join("\n\n"), HTML);
  });

  // --- /count ---
  bot.command("count", async (ctx) => {
    const { count } = await supabase.from("jokes").select("*", { count: "exact", head: true });
    await ctx.reply(`📊 Всего записей в тетрадке: <b>${count ?? 0}</b>`, HTML);
  });

  // --- /find <слово> ---
  bot.command("find", async (ctx) => {
    const q = (ctx.match ?? "").trim();
    if (!q) {
      await ctx.reply("Что искать? Пример: /find проспал");
      return;
    }
    const { data, error } = await supabase.rpc("search_jokes", { p_q: q });
    if (error) {
      console.error(error);
      await ctx.reply("Ошибка поиска 😬");
      return;
    }
    if (!data || data.length === 0) {
      await ctx.reply(`По запросу «${esc(q)}» ничего не нашёл 🤷`);
      return;
    }
    // deno-lint-ignore no-explicit-any
    const lines = data.map((j: any) => `<b>${j.pos}.</b> ${esc(trunc(j.jtext))}  <i>(👍 ${j.likes} · ${esc(j.jauthor)})</i>`);
    const more = data.length >= 30 ? " (первые 30)" : "";
    await ctx.reply(`<b>🔍 Нашёл ${data.length}${more}:</b>\n\n` + lines.join("\n\n"), HTML);
  });

  // --- /stats ---
  bot.command("stats", async (ctx) => {
    const { count } = await supabase.from("jokes").select("*", { count: "exact", head: true });
    const { data: mesto } = await supabase.from("counters").select("n").eq("key", "lenya_mesto").maybeSingle();
    const { data: authors } = await supabase.rpc("author_stats");
    let msg = `<b>📊 Статистика</b>\n\n` +
      `Всего шуток: <b>${count ?? 0}</b>\n` +
      `На место послали: <b>${mesto?.n ?? 0}</b> раз 🐕`;
    if (authors && authors.length > 0) {
      // deno-lint-ignore no-explicit-any
      const lines = authors.map((a: any, i: number) =>
        `${i + 1}. ${esc(a.author)} — ${a.jokes} шт. (👍 ${a.likes})`);
      msg += `\n\n<b>🏆 Топ авторов:</b>\n` + lines.join("\n");
    }
    await ctx.reply(msg, HTML);
  });

  bot.command("list", async (ctx) => {
    const { text, kb } = await renderList(0);
    await ctx.reply(text, kb ? { ...HTML, reply_markup: kb } : HTML);
  });

  // кнопка-номер под /list — прислать шутку
  bot.callbackQuery(/^open:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    const { data: j } = await supabase.from("jokes")
      .select("id, text, added_by, created_at, likes, dislikes, context").eq("id", id).maybeSingle();
    if (!j) {
      await ctx.answerCallbackQuery("Шутка уже удалена 🤷");
      return;
    }
    if (ctx.chat) {
      await bot.api.sendMessage(
        ctx.chat.id,
        `😄 ${esc(j.text)}\n\n<i>👤 ${esc(j.added_by ?? "аноним")} · 🗓 ${fmtDate(j.created_at)}</i>`,
        { ...HTML, reply_markup: jokeKeyboard(j.id, j.likes, j.dislikes, !!j.context) },
      );
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^list:(\d+)$/, async (ctx) => {
    const page = Number(ctx.match![1]);
    const { text, kb } = await renderList(page);
    try {
      await ctx.editMessageText(text, kb ? { ...HTML, reply_markup: kb } : HTML);
    } catch (_) { /* not modified */ }
    await ctx.answerCallbackQuery();
  });

  // --- лайки/дизлайки ---
  bot.callbackQuery(/^(like|dislike):(\d+)$/, async (ctx) => {
    const action = ctx.match![1];
    const jokeId = Number(ctx.match![2]);
    const voteVal = action === "like" ? 1 : -1;
    const userId = ctx.from!.id;
    const { data, error } = await supabase.rpc("vote_joke", {
      p_joke_id: jokeId,
      p_user_id: userId,
      p_vote: voteVal,
    });
    if (error) {
      console.error(error);
      await ctx.answerCallbackQuery("Не получилось 😬");
      return;
    }
    if (!data || data.length === 0) {
      await ctx.answerCallbackQuery("Шутка уже удалена 🤷");
      return;
    }
    const { likes, dislikes } = data[0];
    // кнопка «Контекст» остаётся, если она была на сообщении
    // deno-lint-ignore no-explicit-any
    const hadCtx = (ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? []).flat()
      .some((b: any) => String(b.callback_data ?? "").startsWith("ctx:"));
    const kb = jokeKeyboard(jokeId, likes, dislikes, hadCtx);

    if (ctx.callbackQuery.inline_message_id) {
      // сообщение, отправленное через inline: обновляем и шапку (рейтинг), и кнопки
      const { data: jd } = await supabase.rpc("get_joke", { p_id: jokeId });
      try {
        if (jd && jd.length > 0) {
          await ctx.editMessageText(inlineJokeText(jd[0]), { ...HTML, reply_markup: kb });
        } else {
          await ctx.editMessageReplyMarkup({ reply_markup: kb });
        }
      } catch (_) { /* not modified */ }
    } else {
      // обычное сообщение в чате: обновляем только кнопки
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: kb });
      } catch (_) { /* not modified */ }
    }
    await ctx.answerCallbackQuery();
  });

  // --- /del (удаляющие; можно списком: /del 1 3 5) ---
  bot.command("del", async (ctx) => {
    if (!(await isDeleter(ctx))) {
      await ctx.reply(`Удалять могут только ${DELETERS_TEXT} 🙅`);
      return;
    }
    const parts = (ctx.match ?? "").trim().split(/[\s,]+/).filter(Boolean);
    const positions = [...new Set(parts.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
      .sort((a, b) => a - b);
    if (positions.length === 0) {
      await ctx.reply("Укажи номер(а) из /list:\n/del 3\nили списком: /del 1 3 5");
      return;
    }
    const { data, error } = await supabase
      .from("jokes").select("id, text")
      .order("created_at", { ascending: false }).order("id", { ascending: false });
    if (error || !data) {
      await ctx.reply("Ошибка при загрузке 😬");
      return;
    }
    const toDelete: { id: number; text: string }[] = [];
    const notFound: number[] = [];
    for (const pos of positions) {
      const row = data[pos - 1];
      if (row) toDelete.push(row);
      else notFound.push(pos);
    }
    if (toDelete.length === 0) {
      await ctx.reply(`Не нашёл шуток с номерами: ${notFound.join(", ")}`);
      return;
    }
    const { error: delErr } = await supabase.from("jokes").delete().in("id", toDelete.map((r) => r.id));
    if (delErr) {
      console.error(delErr);
      await ctx.reply("Ошибка при удалении 😬");
      return;
    }
    let msg = `Удалил ${toDelete.length} шт.:\n` + toDelete.map((r) => `🗑 ${r.text}`).join("\n");
    if (notFound.length > 0) msg += `\n\n⚠️ Не нашёл номера: ${notFound.join(", ")}`;
    await ctx.reply(msg);
  });

  // --- /edit <номер> <текст> (удаляющие) ---
  bot.command("edit", async (ctx) => {
    if (!(await isDeleter(ctx))) {
      await ctx.reply(`Редактировать могут только ${DELETERS_TEXT} 🙅`);
      return;
    }
    const raw = (ctx.match ?? "").trim();
    const m = raw.match(/^(\d+)\s+([\s\S]+)$/);
    if (!m) {
      await ctx.reply(`Формат: /edit <номер> <новый текст>\nНапр.: /edit 3 ${LN.nom} снова всё проспал`);
      return;
    }
    const pos = Number(m[1]);
    const newText = m[2].trim();
    if (newText.length > MAX_LEN) {
      await ctx.reply(`Слишком длинно 🙏 (до ${MAX_LEN} символов).`);
      return;
    }
    const { data, error } = await supabase
      .from("jokes").select("id")
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(pos - 1, pos - 1);
    if (error) {
      await ctx.reply("Ошибка 😬");
      return;
    }
    if (!data || data.length === 0) {
      await ctx.reply(`Шутки №${pos} нет. Глянь /list`);
      return;
    }
    const { error: upErr } = await supabase.from("jokes").update({ text: newText }).eq("id", data[0].id);
    if (upErr) {
      console.error(upErr);
      await ctx.reply("Ошибка при сохранении 😬");
      return;
    }
    await ctx.reply(`✏️ Шутка №${pos} обновлена.`);
  });

  // --- /export — выгрузить все шутки файлом ---
  bot.command("export", async (ctx) => {
    const { data, error } = await supabase
      .from("jokes").select("text, added_by, likes, dislikes, created_at")
      .order("created_at", { ascending: true }).order("id", { ascending: true });
    if (error || !data || data.length === 0) {
      await ctx.reply("Пока нечего выгружать — копилка пустая.");
      return;
    }
    const lines = data.map((j, i) =>
      `${i + 1}. ${j.text}\n   — ${j.added_by ?? "аноним"}, ${fmtDate(j.created_at)} | 👍${j.likes} 👎${j.dislikes}`,
    );
    const content = `Тетрадка Пихал Малыча (всего ${data.length})\n\n` + lines.join("\n\n") + "\n";
    const bytes = new TextEncoder().encode(content);
    await ctx.replyWithDocument(new InputFile(bytes, "lenya_jokes.txt"), {
      caption: `💾 Бэкап: ${data.length} шт.`,
    });
  });

  // --- рубильники (владельцы) ---
  bot.command("lenya", async (ctx) => {
    if (!(await isOwner(ctx))) {
      await ctx.reply("Этой командой рулят только админы 🙅");
      return;
    }
    const arg = (ctx.match ?? "").trim().toLowerCase();
    if (arg !== "on" && arg !== "off") {
      const allowed = await getFlag("lenya_can_add");
      await ctx.reply(`${LN.dat} сейчас ${allowed ? "✅ можно" : "🚫 нельзя"} добавлять шутки.\nПереключить: /lenya on  или  /lenya off`);
      return;
    }
    const value = arg === "on";
    const { error } = await setFlag("lenya_can_add", value);
    if (error) {
      await ctx.reply("Ошибка 😬");
      return;
    }
    await ctx.reply(value ? `Готово — ${LN.dat} теперь можно добавлять шутки ✅` : `Готово — ${LN.dat} больше нельзя добавлять шутки 🚫`);
  });

  bot.command("mesto", (ctx) => ownerToggle(ctx, "mesto", "lenya_place", "Реакция «на место»", true));

  bot.command("ugabuga", (ctx) => ownerToggle(ctx, "ugabuga", "ugabuga", "Реакция на «уга-буга» / «уга»", true));

  bot.command("pivo", (ctx) => ownerToggle(ctx, "pivo", "pivo", "Реакция «Кто сказал пиво?!!»", true));

  bot.command("links", (ctx) => ownerToggle(ctx, "links", "link_police", `Реакция на ссылки от ${LINK_SUSPECT_TEXT}`, true));

  bot.command("tut", (ctx) => ownerToggle(ctx, "tut", "lenya_ping", `Аукание «${LN.nom}, ты тут?»`, true));

  // --- /ogryz: рубильник огрызаний; /ogryz test <фраза> — показать, как бот огрызнётся (владельцы) ---
  bot.command("ogryz", async (ctx) => {
    const arg = (ctx.match ?? "").trim();
    const m = arg.match(/^test(?:\s+([\s\S]*))?$/i);
    if (!m) {
      const how = GEMINI_KEY ? "через Gemini, запас — фразы из списка" : "фразы из списка, ключа Gemini нет";
      await ownerToggle(ctx, "ogryz", "snap", `Огрызания на ответы боту (${how})`, true);
      return;
    }
    if (!(await isOwner(ctx))) {
      await ctx.reply("Этой командой рулят только админы 🙅");
      return;
    }
    const userText = (m[1] ?? "мама твоя").trim();
    const name = ctx.from?.first_name ?? "друг";
    const chatId = ctx.chat.id;
    await ctx.replyWithChatAction("typing").catch(() => {});
    const isReaction = /^[\p{Extended_Pictographic}\uFE0F\u200D]+$/u.test(userText); // прислали только эмодзи — как реакция
    await background((async () => {
      const t0 = Date.now();
      const snap = isReaction
        ? await makeReactionSnap("Кто сказал пиво?!!", userText, name)
        : await makeSnap("Кто сказал пиво?!!", userText, name);
      const how = snap.ai ? "🧠 Gemini" : "📋 из списка";
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      await bot.api.sendMessage(
        chatId,
        `${esc(snap.text)}\n\n<i>${how} · ${sec} с · на ${isReaction ? "реакцию" : "ответ"} «${esc(userText)}» после «Кто сказал пиво?!!»</i>`,
        HTML,
      );
    })());
  });

  // --- /roast [@ник|имя] — прожарка участника по его шуткам (или reply на его сообщение) ---
  bot.command("roast", async (ctx) => {
    const arg = (ctx.match ?? "").trim().replace(/^@/, "");
    const t = ctx.msg.reply_to_message?.from;
    const target = t && t.id !== ctx.me.id ? t : null; // reply на чужое сообщение — жарим его автора
    let name = target ? (target.first_name ?? target.username ?? "друг") : (arg || (ctx.from?.first_name ?? "друг"));
    let username = target ? (target.username ?? "").toLowerCase() : (arg ? arg.toLowerCase() : uname(ctx));
    if ([LN.nom.toLowerCase(), LN.nom.toLowerCase().replace("ё", "е"), LENYA].includes(username)) {
      username = LENYA;
      name = arg || name;
    }
    if ((isProtected(name) || isProtected(username)) && (await getFlag("baha_shield", false))) { // защита создатель (/shield on)
      await ctx.reply(pick(isFormal(arg) ? REFUSE_POLITE : REFUSE_RUDE), { reply_parameters: { message_id: ctx.msg.message_id } });
      return;
    }
    const chatId = ctx.chat.id;
    const msgId = ctx.msg.message_id;
    await ctx.replyWithChatAction("typing").catch(() => {});
    await background((async () => {
      const dossier = await buildDossier(name, username);
      const roast = await geminiText(ROAST_SYSTEM, [{ text: dossier }], { temperature: 1.0, maxTokens: 700, maxChars: 900 });
      const text = roast ? `🔥 ${roast}` : pick(ROAST_FALLBACK).replace(/\{name\}/g, name);
      await sendTalk("talk", chatId, text, { reply_parameters: { message_id: msgId } });
      await supabase.rpc("bump_counter", { p_key: "roasts", p_by: 1 });
    })());
  });

  // --- /sud — рассудить спор (лучше ответом на спорное сообщение) ---
  bot.command("sud", async (ctx) => {
    await ctx.replyWithChatAction("typing").catch(() => {});
    await background(judgeCore(ctx, (ctx.match ?? "").trim() || "рассуди"));
  });

  bot.command("ai", (ctx) => ownerToggle(ctx, "ai", "ai_chat", "ИИ-режим (обращение «Пихал/Малыч/бот, …», @тег)", true));

  bot.command("predict", (ctx) => ownerToggle(ctx, "predict", "predict", "Предсказания дня с тегами", true));

  bot.command("shield", (ctx) => ownerToggle(ctx, "shield", "baha_shield", `Защита ${ON.gen} (отказ оскорблять/жарить)`, false));

  // --- /here: привязать/отвязать чат для «шутки дня» (владельцы) ---
  bot.command("here", async (ctx) => {
    if (!(await isOwner(ctx))) {
      await ctx.reply("Эту команду могут только админы 🙅");
      return;
    }
    const chatId = ctx.chat.id;
    const { data: existing } = await supabase
      .from("broadcast_chats").select("chat_id").eq("chat_id", chatId).maybeSingle();
    if (existing) {
      await supabase.from("broadcast_chats").delete().eq("chat_id", chatId);
      await ctx.reply("Больше не буду слать сюда шутку дня 🔕");
    } else {
      await supabase.from("broadcast_chats").upsert({ chat_id: chatId });
      await ctx.reply("Готово! Буду кидать сюда шутку дня каждый день 🗓");
    }
  });

  bot.command("admin", async (ctx) => {
    if (!(await isOwner(ctx))) {
      await ctx.reply("Админка только для админов 🙅");
      return;
    }
    const { text, kb } = await renderPlaceList();
    await ctx.reply(text, kb ? { ...HTML, reply_markup: kb } : HTML);
  });

  bot.command("place", async (ctx) => {
    if (!(await isOwner(ctx))) {
      await ctx.reply("Списком «на место» рулят только админы 🙅");
      return;
    }
    const parts = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] ?? "").toLowerCase();
    if (sub === "add" || sub === "del") {
      const nick = (parts[1] ?? "").replace(/^@/, "").toLowerCase();
      if (!nick) {
        await ctx.reply(`Укажи ник: /place ${sub} @ник`);
        return;
      }
      if (sub === "add") {
        const { error } = await supabase
          .from("place_targets").upsert({ username: nick, added_by: uname(ctx) });
        await ctx.reply(error ? "Ошибка 😬" : `✅ @${nick} теперь в списке «на место».`);
      } else {
        await supabase.from("place_targets").delete().eq("username", nick);
        await ctx.reply(`➖ @${nick} убран из списка.`);
      }
      return;
    }
    const { text, kb } = await renderPlaceList();
    await ctx.reply(text, kb ? { ...HTML, reply_markup: kb } : HTML);
  });

  bot.callbackQuery(/^placedel:(.+)$/, async (ctx) => {
    if (!(await isOwner(ctx))) {
      await ctx.answerCallbackQuery("Только для админов");
      return;
    }
    const nick = ctx.match![1];
    await supabase.from("place_targets").delete().eq("username", nick);
    const { text, kb } = await renderPlaceList();
    try {
      await ctx.editMessageText(text, kb ? { ...HTML, reply_markup: kb } : HTML);
    } catch (_) { /* not modified */ }
    await ctx.answerCallbackQuery(`@${nick} убран из списка`);
  });

  bot.command("phrases", async (ctx) => {
    if (!(await isOwner(ctx))) {
      await ctx.reply("Фразами «на место» рулят только админы 🙅");
      return;
    }
    const raw = (ctx.match ?? "").trim();
    const m = raw.match(/^(add|del)\s+([\s\S]+)$/i);
    if (m) {
      const sub = m[1].toLowerCase();
      const rest = m[2].trim();
      if (sub === "add") {
        if (rest.length > MAX_LEN) {
          await ctx.reply(`Слишком длинно 🙏 (до ${MAX_LEN} символов).`);
          return;
        }
        const { error } = await supabase
          .from("place_phrases").insert({ text: rest, added_by: uname(ctx) });
        await ctx.reply(error ? "Ошибка 😬" : `✅ Добавил фразу:\n${esc(rest)}`, HTML);
      } else {
        const pos = Number(rest);
        if (!Number.isInteger(pos) || pos <= 0) {
          await ctx.reply("Укажи номер из списка: /phrases del 2");
          return;
        }
        const { data } = await supabase
          .from("place_phrases").select("id")
          .order("created_at", { ascending: true }).order("id", { ascending: true })
          .range(pos - 1, pos - 1);
        if (!data || data.length === 0) {
          await ctx.reply(`Фразы №${pos} нет. Глянь /phrases`);
          return;
        }
        await supabase.from("place_phrases").delete().eq("id", data[0].id);
        await ctx.reply(`➖ Фраза №${pos} удалена.`);
      }
      return;
    }
    const { text, kb } = await renderPhraseList();
    await ctx.reply(text, kb ? { ...HTML, reply_markup: kb } : HTML);
  });

  bot.callbackQuery(/^phrdel:(\d+)$/, async (ctx) => {
    if (!(await isOwner(ctx))) {
      await ctx.answerCallbackQuery("Только для админов");
      return;
    }
    const id = Number(ctx.match![1]);
    await supabase.from("place_phrases").delete().eq("id", id);
    const { text, kb } = await renderPhraseList();
    try {
      await ctx.editMessageText(text, kb ? { ...HTML, reply_markup: kb } : HTML);
    } catch (_) { /* not modified */ }
    await ctx.answerCallbackQuery("Фраза удалена");
  });

  bot.command("owners", async (ctx) => {
    if (!(await isOwner(ctx))) {
      await ctx.reply("Админами рулят только админы 🙅");
      return;
    }
    const parts = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] ?? "").toLowerCase();
    if (sub === "add" || sub === "del") {
      const nick = (parts[1] ?? "").replace(/^@/, "").toLowerCase();
      if (!nick) {
        await ctx.reply(`Укажи ник: /owners ${sub} @ник`);
        return;
      }
      if (nick === SUPER_OWNER) {
        await ctx.reply(`@${SUPER_OWNER} — главный админ, его трогать нельзя 🙅`);
        return;
      }
      if (sub === "add") {
        const { error } = await supabase
          .from("owners").upsert({ username: nick, added_by: uname(ctx) });
        await ctx.reply(error ? "Ошибка 😬" : `✅ @${nick} теперь админ.`);
      } else {
        await supabase.from("owners").delete().eq("username", nick);
        await ctx.reply(`➖ @${nick} больше не админ.`);
      }
      return;
    }
    const { text, kb } = await renderOwnerList();
    await ctx.reply(text, kb ? { ...HTML, reply_markup: kb } : HTML);
  });

  bot.callbackQuery(/^ownerdel:(.+)$/, async (ctx) => {
    if (!(await isOwner(ctx))) {
      await ctx.answerCallbackQuery("Только для админов");
      return;
    }
    const nick = ctx.match![1];
    if (nick !== SUPER_OWNER) await supabase.from("owners").delete().eq("username", nick);
    const { text, kb } = await renderOwnerList();
    try {
      await ctx.editMessageText(text, kb ? { ...HTML, reply_markup: kb } : HTML);
    } catch (_) { /* not modified */ }
    await ctx.answerCallbackQuery(nick === SUPER_OWNER ? "Главного снять нельзя" : `@${nick} снят`);
  });

  // --- реакции на обычные сообщения (нужен выключенный privacy mode) ---
  bot.on("message", async (ctx) => {
    // личка создателя — личный ассистент (текст, голосовые, скриншоты, пересланное); в журналы не пишем
    if (ctx.chat.type === "private" && (await isPaOwner(ctx))) {
      if ((ctx.msg.text ?? "").startsWith("/")) return;
      if (ctx.msg.location) { // геолокация: запомнить место, напомнить про заметки рядом
        const l = ctx.msg.location;
        await background(paOnLocation(ctx.chat.id, l.latitude, l.longitude, !!l.live_period,
          l.live_period ? { date: ctx.msg.date, period: l.live_period } : undefined));
        return;
      }
      await ctx.replyWithChatAction("typing").catch(() => {});
      await background(paHandle(ctx));
      return;
    }
    // голосовые, стикеры, фото, видео, файлы и прочее без текста — не реагируем вообще (и не пишем в журнал)
    if (!ctx.msg.text) return;
    const text = ctx.msg.text;
    if (text.startsWith("/")) return;

    // журнал последних сообщений чата — для контекста шуток (старое чистится раз в сутки); личку не пишем
    if (text && ctx.chat.type !== "private") {
      const { error } = await supabase.from("chat_log").insert({
        chat_id: ctx.chat.id, message_id: ctx.msg.message_id,
        user_name: ctx.from?.first_name ?? "аноним", text: trunc(text, 500),
        user_id: ctx.from?.id ?? null, username: ctx.from?.username ?? null,
      });
      if (error) console.error("chat_log insert failed", error);
    }

    // герой отозвался после пинга «ты тут?» — объявляем и снимаем ожидание
    if (uname(ctx) === LENYA && (await getFlag("lenya_waiting", false))) {
      await setFlag("lenya_waiting", false);
      await sendTalk("talk", ctx.chat.id, pick(HERE_PHRASES));
      return;
    }

    // ссылка от того, кому ссылки кидать не положено (рубильник /links)
    if (LINK_SUSPECTS.has(uname(ctx)) && hasLink(ctx) && (await getFlag("link_police", true))) {
      await sendTalk("talk", ctx.chat.id, LINK_PHRASE, { reply_parameters: { message_id: ctx.msg.message_id } });
      return;
    }

    // обращение к боту («бот, …», @тег) — ИИ-режим: болтовня или команда словами (рубильник /ai)
    if (text && mentionsBot(ctx, text) && (await getFlag("ai_chat", true))) {
      const sg = await spamCheck(ctx.chat.id, ctx.from?.id ?? 0); // антиспам
      if (sg === "muted") return;
      if (sg === "warn") {
        await ctx.reply(spamWarn(ctx.from?.first_name ?? "друг"), { reply_parameters: { message_id: ctx.msg.message_id } });
        return;
      }
      await ctx.replyWithChatAction("typing").catch(() => {});
      await background(assistantCore(ctx, text));
      return;
    }

    // ответ на сообщение бота — огрызаемся (рубильник /ogryz); если это просьба словами («добавь шутку …») — выполняем
    if (isReplyToBot(ctx) && (await getFlag("snap", true))) {
      // ответ на сервисное сообщение (шутка, список, контекст, «Записал»…) — молчим, если это не просьба словами
      const kind = await botMsgKind(ctx.chat.id, ctx.msg.reply_to_message!.message_id);
      const wantsCmd = commandLike(text) && (await getFlag("ai_chat", true));
      if (kind === "service" && !wantsCmd) return;
      const sg = await spamCheck(ctx.chat.id, ctx.from?.id ?? 0); // антиспам
      if (sg === "muted") return;
      if (sg === "warn") {
        await ctx.reply(spamWarn(ctx.from?.first_name ?? "друг"), { reply_parameters: { message_id: ctx.msg.message_id } });
        return;
      }
      await ctx.replyWithChatAction("typing").catch(() => {}); // «печатает…», пока Gemini думает
      if (commandLike(text) && (await getFlag("ai_chat", true))) {
        await background(assistantCore(ctx, text));
        return;
      }
      if (nightSkip()) return; // ночью огрызается через раз
      await background(snapCore(ctx, text));
      return;
    }

    // «на место» — на сообщение любого, кто есть в списке place_targets
    if ((await isPlaceTarget(uname(ctx))) && (await getFlag("lenya_place", true))) {
      const phrase = await pickPlacePhrase(ctx.from?.first_name ?? "друг");
      await sendTalk("talk", ctx.chat.id, phrase, { reply_parameters: { message_id: ctx.msg.message_id } });
      await supabase.rpc("bump_counter", { p_key: "lenya_mesto", p_by: 1 });
      return;
    }

    const lower = text.toLowerCase();
    const norm = lower.replace(/[\s\-_]/g, "");
    const words = lower.split(/[^а-яёa-z0-9]+/i).filter(Boolean);

    // «уга-буга» / «уга» (рубильник /ugabuga)
    if (await getFlag("ugabuga", true)) {
      if (norm.includes("угабуга")) {
        // похвалить написавшего голосом туземца
        const name = esc(ctx.from?.first_name ?? "друг");
        await sendTalk("talk", ctx.chat.id, `${name}, ${pick(PRAISES)}`, { reply_parameters: { message_id: ctx.msg.message_id } });
      } else if (words.includes("уга")) {
        // на одинокое «уга» — просто пишем «буга» в чат (без ответа-цитаты, без эмодзи)
        await sendTalk("talk", ctx.chat.id, "буга");
      }
    }

    // «пиво» и его склонения/формы (рубильник /pivo)
    // пиво/пива/пиву/пивом/пиве + пивко… + пивас(ик)… — но не «пивная/пивовар»
    const pivoWord = /^пив(о|а|у|е|ом|ко|ка|ку|ке|ком|ас|аса|асу|асе|асом|асик|асика|асику|асиком|асике)$/;
    if (words.some((w) => pivoWord.test(w)) && (await getFlag("pivo", true))) {
      await sendTalk("talk", ctx.chat.id, "Кто сказал пиво?!!");
    }
  });

  // --- реакции (лайки и т.п.) на сообщения бота — огрызаемся (рубильник /ogryz) ---
  // Telegram шлёт message_reaction только если бот АДМИН в группе и в setWebhook указан
  // allowed_updates с "message_reaction" (см. ?task=webhook). Реакции от ботов не приходят.
  bot.on("message_reaction", async (ctx) => {
    const r = ctx.messageReaction;
    if (!(await getFlag("snap", true))) return;
    const { data: own } = await supabase.from("bot_messages").select("text, kind")
      .eq("chat_id", r.chat.id).eq("message_id", r.message_id).maybeSingle();
    if (!own) return; // реакция не на наше сообщение
    if (own.kind === "service") return; // лайки на шутки, списки, контекст и прочее сервисное — молчим
    const oldKeys = new Set(r.old_reaction.map(reactionKey));
    const added = r.new_reaction.filter((x) => !oldKeys.has(reactionKey(x)));
    if (added.length === 0) return; // реакцию сняли — молчим
    if (r.user) { // антиспам (лайки тоже считаются дёрганием)
      const sg = await spamCheck(r.chat.id, r.user.id);
      if (sg === "muted") return;
      if (sg === "warn") {
        await bot.api.sendMessage(r.chat.id, spamWarn(r.user.first_name ?? "друг"), { reply_parameters: { message_id: r.message_id } });
        return;
      }
    }
    if (own.kind === "snap" && Math.random() >= SNAP_REACT_PROB) return; // на лайки к своим огрызам — редко
    // каждому — не больше двух огрызов на реакции в день (день по Ашхабаду)
    if (r.user) {
      const day = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
      const dkey = `rday:${r.chat.id}:${r.user.id}:${day}`;
      const { data: used } = await supabase.from("counters").select("n").eq("key", dkey).maybeSingle();
      if (used && Number(used.n) >= 2) return;
      await supabase.from("counters").upsert({ key: dkey, n: Number(used?.n ?? 0) + 1 });
    }
    if (nightSkip()) return; // ночью — через раз
    // не чаще одного огрыза на реакции к одному сообщению раз в 90 с (спам сердечками ≠ спам ответами)
    const rkey = `rsnap:${r.chat.id}:${r.message_id}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const { data: lastSnap } = await supabase.from("counters").select("n").eq("key", rkey).maybeSingle();
    if (lastSnap && nowSec - Number(lastSnap.n) < 90) return;
    await supabase.from("counters").upsert({ key: rkey, n: nowSec });
    const emoji = added.map(reactionLabel).join("");
    const name = r.user?.first_name ?? r.actor_chat?.title ?? "кто-то";
    const chatId = r.chat.id;
    const msgId = r.message_id;
    const botText = own.text ?? "";
    await background((async () => {
      const snap = await makeReactionSnap(botText, emoji, name); // реакция без текста — про создателя не напоминаем
      await sendTalk("snap", chatId, snap.text, { reply_parameters: { message_id: msgId } });
      await supabase.rpc("bump_counter", { p_key: snap.ai ? "snaps_ai" : "snaps_list", p_by: 1 });
    })());
  });

  // --- inline-режим: @<юзернейм бота> <слово> в любом чате ---
  bot.on("inline_query", async (ctx) => {
    const q = ctx.inlineQuery.query.trim();
    const { data } = await supabase.rpc("search_jokes", { p_q: q });
    const rows = data ?? [];
    // deno-lint-ignore no-explicit-any
    const results = rows.slice(0, 50).map((j: any) => ({
      type: "article" as const,
      id: String(j.id),
      title: trunc(j.jtext, 64),
      description: `👍 ${j.likes} 👎 ${j.dislikes} · ${j.jauthor}`,
      input_message_content: { message_text: inlineJokeText(j), parse_mode: "HTML" as const },
      reply_markup: jokeKeyboard(j.id, j.likes, j.dislikes),
    }));
    await ctx.answerInlineQuery(results, { cache_time: 10 });
  });

  Deno.serve(async (req) => {
    try {
      const url = new URL(req.url);
      const task = url.searchParams.get("task");
      if (task === "daily" || task === "weekly" || task === "ping" || task === "here" || task === "webhook" || task === "me" || task === "remind" || task === "pasum" || task === "paweek" || task === "paeve") {
        if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
          return new Response("forbidden", { status: 403 });
        }
        if (task === "webhook") return Response.json(await setupWebhook());
        if (task === "me") return Response.json(await bot.api.getMe()); // кто я (id/username) — для отладки
        if (task === "remind") { await processReminders(); return new Response("remind ok"); }
        if (task === "pasum") { await background(sendPaSummary()); return new Response("pasum ok"); }
        if (task === "paweek") { await background(sendPaWeekly()); return new Response("paweek ok"); }
        if (task === "paeve") { await background(sendPaEvening()); return new Response("paeve ok"); }
        if (task === "daily") await background(sendDailyJoke()); // в фоне: Gemini думает дольше, чем cron ждёт
        else if (task === "weekly") await sendWeeklyDigest();
        else if (task === "here") await sendHereTest();
        else await sendLenyaPing(url.searchParams.get("force") === "1");
        return new Response(`${task} ok`);
      }
      return await handleUpdate(req);
    } catch (e) {
      console.error(e);
      return new Response("error", { status: 500 });
    }
  });
}
