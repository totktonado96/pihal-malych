// Личный ассистент создателя (только личка): память, напоминания, доступы, документы, работа.
// Пихал Малыч: тетрадка шуток чата + реакции + шутка дня.
// Хостинг — Supabase Edge Functions.
// ВАЖНО: реакции на обычные сообщения требуют ВЫКЛЮЧЕННОГО privacy mode у бота
// (@BotFather → Group Privacy → Turn off) + переподключения бота в группу.

import { Bot, InlineKeyboard, InputFile, Keyboard, webhookCallback } from "https://esm.sh/grammy@1.30.0";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding@1/base64";
import { ON } from "./config.ts";
import { BOT_TOKEN, GEMINI_KEY, GEMINI_MODELS_PERSONAL, HTML, SUPER_OWNER, background, bot, esc, geminiText, getFlag, ownerToggle, supabase, trunc, uname } from "./core.ts";

// ============================================================================================
// ЛИЧНЫЙ АССИСТЕНТ СОЗДАТЕЛЯ — только в личке и только ему. Без характера: коротко и по делу.
// Память: pa_notes (смысловой поиск), pa_people, pa_reminders, pa_history; доступы — pa_secrets (AES-GCM).
// Секреты НИКОГДА не уходят в Gemini: «сохрани пароль/доступ …» → следующее сообщение шифруется и удаляется.
// ============================================================================================
export const PA_MODELS = GEMINI_MODELS_PERSONAL;

// экономия: простые короткие сообщения («запомни…», «купить…», «Петя вернул 200») — сначала лёгкая модель (500 в день),
// вопросы, скриншоты, голосовые и длинное — умные (по 20 в день)
export const PA_MODELS_CHEAP = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", ...GEMINI_MODELS_PERSONAL];

export function paIsSimple(text: string, hasImage: boolean, isVoice: boolean): boolean {
  if (hasImage || isVoice) return false;
  const t = text.trim();
  if (t.length > 160 || t.includes("?")) return false;
  if (/^(что|как|кто|где|когда|почему|зачем|сколько|какой|какая|какие|напомни мне что|расскажи|найди|покажи|собери|подскажи|посоветуй)/i.test(t)) return false;
  return true;
}

export const PA_KEY_B64 = Deno.env.get("PA_SECRET_KEY") ?? "";

export const PA_TZ_H = 5;

 // Ашхабад, UTC+5
export const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export const PA_SYSTEM = `Ты — личный ассистент ${ON.gen} в Telegram. Характера нет: отвечаешь коротко, точно, по делу, на «ты», без шуток и мата. Ты ведёшь его долговременную память: заметки, людей, напоминания. Ниже в сообщении — текущее время, его память (напоминания, люди, похожие заметки с id, названия сохранённых доступов), недавняя история диалога и новое сообщение (текст, расшифровка голосового или скриншот).
Верни JSON {"reply": ..., "alert": ..., "actions": [...]}.
Действия (actions):
- note {text, kind: note|meeting|fact|screenshot, people[]} — когда он сообщает факт, договорённость, встречу, контакт, телефон, адрес, присылает скриншот или пересылает сообщение — и это стоит запомнить. text — самодостаточная запись: что, кто, когда, где, о чём договорились; даты — абсолютные, например 30.09.2026. Для скриншота переписки: кто с кем, суть, ключевые фразы дословно, суммы, даты, телефоны. Не дублируй то, что уже есть в похожих заметках.
- remind {text, due, repeat} — когда просит напомнить. due — ISO 8601 с +05:00, вычисли от «Сейчас»; если время не сказано — 10:00. repeat: none|daily|weekly|monthly|yearly.
- person {name, fact} — для упомянутого человека с НОВЫМ фактом о нём. name — как он его называет, с уточнением, если оно есть: «Иван (банк)». Используй существующее имя из списка людей, если это тот же человек.
- place {name, text, here} — когда он говорит, где находится или где что-то было («я в кафе Ёлка», «встретились у Пети дома»): name — короткое название места (как он его называет; используй существующее из списка мест, если это оно), text — новый факт о месте или пусто, here — true, если он сейчас там.
- Для note, remind и money, связанных с местом, укажи place — название места.
- promise {who: me|them, name, text, due} — любое обещание: «я обещал Ивану скинуть договор до пятницы» (who=me), «Иван обещал ставку 18% до пятницы» (who=them). due — срок ISO с +05:00 или пусто. Если обещание выполнено — promise_done {id}.
- task {text} — дело без точного времени: купить, позвонить, сделать, сходить. Сделано — task_done {id}. Если у дела есть точное время — это remind.
- doc_start {label, due} — хочет сохранить документ или его скан/фото (паспорт, права, страховка, договор): label — название документа, due — дата окончания срока действия (ISO), если назвал. Сами сканы он пришлёт следующими сообщениями, ты их не увидишь.
- Если он собирается туда, где нужен документ из списка документов (банк, нотариус, посольство, аэропорт, ГАИ, госуслуги, врач), — напомни в reply взять его, а в remind перед таким визитом допиши в text, что взять.
- Здоровье (лекарства, приёмы, анализы, врачи, самочувствие) — note с kind health; приём лекарств по расписанию — remind с repeat.
- Телефонная книжка: если упомянутый человек есть в книжке — используй это (номер, организация). Если под имя подходит несколько контактов и из контекста не ясно, кто именно, — спроси в reply, кого он имеет в виду (перечисли варианты с организацией и последними цифрами номера), и не сохраняй факты о нём, пока не уточнит. Когда ясно — в person.fact можно добавить номер из книжки.
- alias {name, fact} — когда он говорит, что это один и тот же человек («Руся — это Иван», «банкир = Иван»): name — основное имя из списка людей, fact — прозвище. Если человек из списка упомянут по прозвищу — используй основное имя во всех действиях.
- work {name, kind, status, text} — проект, стартап, клиент, место работы или поездка: name — короткое название (используй существующее из списка «Работа», если это оно); kind: project | client | job | trip; status: idea | active | paused | closed (меняй, когда он говорит «запустили», «закрыли», «на паузе»); text — описание или новые подробности, или пусто.
- work_member {work, name, fact} — человек в работе: work — название, name — имя человека, fact — роль и условия («партнёр, 30%», «дизайнер», «выбыл»). Для самого человека дополнительно person с этим фактом.
- Для note, remind, task, promise, money, связанных с работой из списка (или новой) — укажи work — её название.
- forget_topic {text} — когда просит удалить ВСЁ про какую-то тему («удали все заметки про поликлинику», «забудь всё про ремонт»): text — тема. Я сам найду подходящие заметки и спрошу подтверждение.
- forget_note {id}, forget_person {name}, cancel_reminder {id} — когда просит забыть, удалить, отменить. id бери из памяти ниже.
- money {name, amount, currency, text} — любые деньги с людьми: долги, займы, возвраты, кто сколько должен. amount > 0 — ему должны, amount < 0 — он должен; возврат долга — запись с противоположным знаком. currency — TMT, USD, RUB, EUR (по умолчанию TMT). text — за что. Балансы по людям — в памяти ниже.
- Для встречи или события с известными датой и временем, кроме note, сам добавь remind {text: «Через час: <что и с кем>», due: за час до начала, prep: true} — даже если не просил.
- secret_start {label} — когда хочет сохранить пароль, доступ к серверу, ключ, токен, логин, реквизиты. label — что это и для чего. Сам секрет он пришлёт следующим сообщением, ты его не увидишь.
Никогда не пиши пароли, ключи, токены, номера карт в note — используй secret_start. Если просит выдать или удалить сохранённый доступ или документ — скажи, чтобы написал «дай пароль от …» / «удали пароль от …» / «удали скан …» (это делается без тебя), и назови подходящее название из списка.
Поля заполняй только данными, без своих рассуждений. reply — ответ ему. На вопросы отвечай по памяти ниже и по своим знаниям; если в памяти этого нет — так и скажи, не выдумывай. Про сохранённое подтверди одной строкой. Даты пиши как 12.03.2027 10:00.
alert — если он сейчас в месте (по геометке или сказал словами), про которое есть заметки (см. «Заметки об этом месте»), и там есть что-то важное — напомни. Также alert — если новое сообщение связано с тем, что уже есть в памяти, и это потенциально важно: пересечение встреч, приближающийся срок, забытое обещание, долг, противоречие со старой договорённостью, человек, о котором есть важный факт. Одно-два предложения: что именно и почему важно. Если ничего такого — пустая строка.`;

export const PA_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    alert: { type: "STRING" },
    actions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: ["note", "remind", "person", "forget_note", "forget_person", "cancel_reminder", "secret_start", "money", "alias", "place", "promise", "promise_done", "task", "task_done", "doc_start", "forget_topic", "work", "work_member"] },
          text: { type: "STRING", description: "текст заметки или напоминания, коротко, без рассуждений" },
          due: { type: "STRING", description: "для remind: дата-время ISO 8601 с +05:00, например 2026-09-24T10:00:00+05:00" },
          repeat: { type: "STRING", enum: ["none", "daily", "weekly", "monthly", "yearly"] },
          kind: { type: "STRING", enum: ["note", "meeting", "fact", "screenshot", "health", "project", "client", "job", "trip"] },
          people: { type: "ARRAY", items: { type: "STRING" } },
          name: { type: "STRING", description: "для person/forget_person: имя с уточнением" },
          fact: { type: "STRING", description: "для person: новый факт о человеке" },
          id: { type: "INTEGER" },
          label: { type: "STRING", description: "для secret_start: что за доступ и для чего" },
          amount: { type: "NUMBER", description: "для money: > 0 ему должны, < 0 он должен" },
          currency: { type: "STRING" },
          prep: { type: "BOOLEAN", description: "для remind: напоминание перед встречей — собрать всё по теме" },
          place: { type: "STRING", description: "название места, к которому относится запись" },
          here: { type: "BOOLEAN", description: "для place: он сейчас там" },
          who: { type: "STRING", enum: ["me", "them"], description: "для promise: me — он обещал, them — ему обещали" },
          work: { type: "STRING", description: "название работы/проекта/клиента/поездки, к которой относится запись" },
          status: { type: "STRING", enum: ["idea", "active", "paused", "closed"] },
        },
        required: ["type"],
        propertyOrdering: ["type", "who", "name", "work", "status", "text", "due", "repeat", "prep", "kind", "people", "amount", "currency", "fact", "id", "label", "place", "here"],
      },
    },
  },
  required: ["reply", "actions"],
  propertyOrdering: ["actions", "reply", "alert"],
};

// ответ ассистента годен: валидный JSON, без зацикливания (один кусок повторяется много раз подряд)
export function paOutputOk(out: string): boolean {
  if (/(.{3,40}?)\1{5,}/s.test(out)) return false;
  try {
    const o = JSON.parse(out);
    if (typeof o !== "object" || o === null || !Array.isArray(o.actions)) return false;
    // у каждого действия — обязательные поля (лёгкие модели иногда отдают пустышки)
    const need: Record<string, string[]> = {
      note: ["text"], remind: ["text", "due"], promise: ["text"], task: ["text"], person: ["name", "fact"],
      money: ["name", "amount"], place: ["name"], alias: ["name", "fact"], forget_note: ["id"], cancel_reminder: ["id"],
      promise_done: ["id"], task_done: ["id"], forget_person: ["name"], secret_start: ["label"], forget_topic: ["text"],
      work: ["name"], work_member: ["work"],
    };
    // deno-lint-ignore no-explicit-any
    return o.actions.every((a: any) => (need[a?.type] ?? []).every((k) => a[k] !== undefined && a[k] !== "" && a[k] !== null));
  } catch {
    return false;
  }
}

export const PA_SUMMARY_SYSTEM = `Ты — личный ассистент ${ON.gen}. Составь утреннюю сводку на сегодня: напоминания на сегодня и ближайшие дни, встречи и сроки из заметок, важное, о чём стоит помнить. Коротко, списком, по делу, без приветствий и воды; даты как 12.03.2027 10:00. Если на сегодня ничего нет — одной строкой скажи об этом и назови ближайшее по датам.`;

// --- время по Ашхабаду ---
export function ashParts(d = new Date()) {
  const a = new Date(d.getTime() + PA_TZ_H * 3600e3);
  const p = (n: number) => String(n).padStart(2, "0");
  return { a, date: `${p(a.getUTCDate())}.${p(a.getUTCMonth() + 1)}.${a.getUTCFullYear()}`, time: `${p(a.getUTCHours())}:${p(a.getUTCMinutes())}` };
}

export function fmtAsh(iso: string | Date): string {
  const { date, time } = ashParts(new Date(iso));
  return `${date} ${time}`;
}

export function ashNowText(): string {
  const { a, date, time } = ashParts();
  return `${date} ${time}, ${WEEKDAYS[a.getUTCDay()]} (Ашхабад, UTC+5)`;
}

// --- кто владелец: ник создателя в личке; его id запоминаем (для напоминаний и если ник сменится) ---
export async function paOwnerId(): Promise<number | null> {
  const { data } = await supabase.from("counters").select("n").eq("key", "pa_owner_id").maybeSingle();
  return data ? Number(data.n) : null;
}

// deno-lint-ignore no-explicit-any
export async function isPaOwner(ctx: any): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from) return false;
  const stored = await paOwnerId();
  // хозяин определяется ТОЛЬКО по id аккаунта. Ник — лишь для самой первой привязки, пока id не записан:
  // иначе тот, кто займёт освободившийся ник, получил бы всю память и пароли
  if (stored != null) return stored === ctx.from.id;
  if (uname(ctx) === SUPER_OWNER) {
    await supabase.from("counters").upsert({ key: "pa_owner_id", n: ctx.from.id });
    return true;
  }
  return false;
}

// --- шифрование доступов: AES-GCM, ключ только в секретах функции ---
export async function paKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", decodeBase64(PA_KEY_B64), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string): Promise<{ cipher: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await paKey(), new TextEncoder().encode(plain));
  return { cipher: encodeBase64(new Uint8Array(buf)), iv: encodeBase64(iv) };
}

export async function decryptSecret(cipher: string, iv: string): Promise<string> {
  const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(iv) }, await paKey(), decodeBase64(cipher));
  return new TextDecoder().decode(buf);
}

// --- ожидание секрета: после «сохрани пароль/доступ …» следующее сообщение шифруется ---
export async function paGetPending(): Promise<string | null> {
  const { data } = await supabase.from("pa_state").select("value").eq("key", "pending_secret").maybeSingle();
  if (!data) return null;
  try {
    const o = JSON.parse(data.value);
    if (Date.now() - Number(o.at) > 15 * 60e3) return null; // ждём не дольше 15 минут
    return String(o.label);
  } catch {
    return null;
  }
}

export async function paSetPending(label: string | null) {
  if (label == null) await supabase.from("pa_state").delete().eq("key", "pending_secret");
  else await supabase.from("pa_state").upsert({ key: "pending_secret", value: JSON.stringify({ label, at: Date.now() }) });
}

// «сохрани пароль от …», «запомни доступ к серверу …» — распознаём сами, без нейросети
export function secretStartLabel(text: string): string {
  const m = text.trim().match(/^(?:сохрани|запомни|запиши|зашифруй|спрячь)(?:те)?\s+(?:мне\s+)?((?:пароль|пароли|пасс|доступ|доступы|ключ|ключи|токен|логин|пин|pin|секрет|реквизиты|ssh|креды)[\s\S]*)$/i);
  return m ? m[1].trim() : "";
}

// «дай/покажи/скинь пароль от …» — выдаём сами, без нейросети; возвращает запрос или ""
export function secretAskQuery(text: string): string {
  const m = text.trim().match(/^(?:дай|покажи|скинь|выдай|пришли|напомни)(?:те)?\s+(?:мне\s+)?(?:все\s+|всё\s+)?(?:паролей|пароли|пароль|доступов|доступы|доступ|ключи|ключ|токены|токен|логины|логин|пин|реквизиты|креды|кред)(?![а-яё])(?:\s+и\s+(?:паролей|пароли|пароль|доступов|доступы|доступ|ключи|ключ|токены|токен|логины|логин|пин|реквизиты|креды|кред)(?![а-яё]))?\s*(?:(?:от|к|для|на|по|про)(?![а-яё]))?\s*([\s\S]*)$/i);
  return m ? m[1].trim() : "";
}

// «удали/сотри/забудь пароль от карты», «удали скан паспорта» — сами, без нейросети
export function secretDeleteQuery(text: string): string {
  const m = text.trim().match(/^(?:удали|сотри|забудь|убери|снеси)(?:те)?\s+(?:мне\s+)?(?:все\s+|всё\s+)?(?:паролей|пароли|пароль|доступов|доступы|доступ|ключи|ключ|токены|токен|логины|логин|пин|реквизиты|креды|кред)(?![а-яё])(?:\s+и\s+(?:паролей|пароли|пароль|доступов|доступы|доступ|ключи|ключ|токены|токен|логины|логин|пин|реквизиты|креды|кред)(?![а-яё]))?\s*(?:(?:от|к|для|на|по|про)(?![а-яё]))?\s*([\s\S]*)$/i);
  return m ? m[1].trim() : "";
}

export function docDeleteQuery(text: string): string {
  const m = text.trim().match(/^(?:удали|сотри|забудь|убери)(?:те)?\s+(?:мне\s+)?(?:все\s+|всё\s+)?(?:скан\S*|фото|документ\S*|копи\S*)\s*(?:от|к|для|про|о|об|по|насч[её]т|из|с)?\s*([\s\S]*)$/i);
  return m ? m[1].trim() : "";
}

// найти доступ по номеру из /pass или по словам в названии
// deno-lint-ignore no-explicit-any
export async function findSecrets(q: string): Promise<any[]> {
  const { data } = await supabase.from("pa_secrets").select("id, label, cipher, iv, work_id").order("id");
  const all = data ?? [];
  // «все доступы по Альфе» — всё, что привязано к работе, даже если в названии её нет
  const wk = workMentioned(await allWork(), q);
  if (wk.length && !/^\d+$/.test(q)) {
    const ids = new Set(wk.map((w) => w.id));
    const byWork = all.filter((x) => x.work_id && ids.has(x.work_id));
    if (byWork.length) return byWork;
  }
  if (/^\d+$/.test(q)) return all[Number(q) - 1] ? [all[Number(q) - 1]] : [];
  // «по проекту Альфа», «клиента Ивана» — служебные слова не ищем, ищем суть
  const filler = /^(проект|клиент|клиентк|человек|челик|сервер|аккаунт|учётк|учетк|все|всё|для|про|под|свои|свой|мои|мой)/;
  const allWords = q.toLowerCase().split(/[^а-яёa-z0-9]+/i).filter((w) => w.length >= 3);
  const meaningful = allWords.filter((w) => !filler.test(w));
  const words = meaningful.length ? meaningful : allWords; // «доступ к серверу» — ищем и по служебному, если другого нет
  if (words.length === 0) return [];
  return all.filter((s) => words.every((w) => s.label.toLowerCase().includes(w.slice(0, Math.max(3, w.length - 2)))));
}

// выдать доступ и стереть его из чата через минуту
// deno-lint-ignore no-explicit-any
export async function sendSecret(chatId: number, s: any) {
  let value: string;
  try {
    value = await decryptSecret(s.cipher, s.iv);
  } catch {
    await bot.api.sendMessage(chatId, `Не смог расшифровать «${s.label}» — ключ поменялся?`);
    return;
  }
  const m = await bot.api.sendMessage(chatId, `🔐 ${esc(s.label)}\n\n<code>${esc(value)}</code>\n\n<i>удалю через минуту</i>`, HTML);
  await background((async () => {
    await new Promise((r) => setTimeout(r, 60_000));
    await bot.api.deleteMessage(chatId, m.message_id).catch(() => {});
  })());
}

// --- смысловой поиск ---
export async function embed(text: string): Promise<number[] | null> {
  if (!GEMINI_KEY || !text.trim()) return null;
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({ content: { parts: [{ text: trunc(text, 6000) }] }, outputDimensionality: 768 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error("embed", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    return (await res.json()).embedding?.values ?? null;
  } catch (e) {
    console.error("embed failed", String(e).slice(0, 200));
    return null;
  }
}

// --- скачать файл из Telegram (голосовое, скриншот) ---
export async function tgDownload(fileId: string): Promise<Uint8Array | null> {
  try {
    const f = await bot.api.getFile(fileId);
    if (!f.file_path) return null;
    const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${f.file_path}`);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch (e) {
    console.error("download failed", String(e).slice(0, 200));
    return null;
  }
}

// расшифровка голосового (для ассистента)
export async function paTranscribe(fileId: string, mime: string): Promise<string | null> {
  const bytes = await tgDownload(fileId);
  if (!bytes) return null;
  const t = await geminiText("Ты — точный транскрибатор аудио.", [
    { inline_data: { mime_type: mime || "audio/ogg", data: encodeBase64(bytes) } },
    { text: "Расшифруй голосовое дословно, на языке оригинала. Верни только текст расшифровки. Если речи нет — пустую строку." },
  ], { models: PA_MODELS, temperature: 0.2, maxTokens: 3000, maxChars: 6000, timeoutMs: 40_000, deadlineMs: 90_000 });
  return t?.trim() || null;
}

// --- геолокация: последняя точка, адрес, заметки рядом ---
export const NEAR_M = 400;

 // «рядом с местом» — радиус в метрах
export function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function paLastLoc(maxAgeMin = 60): Promise<{ lat: number; lon: number; place: string } | null> {
  const { data } = await supabase.from("pa_state").select("value").eq("key", "last_loc").maybeSingle();
  if (!data) return null;
  try {
    const o = JSON.parse(data.value);
    return Date.now() - Number(o.at) <= maxAgeMin * 60e3 ? { lat: o.lat, lon: o.lon, place: o.place ?? "" } : null;
  } catch {
    return null;
  }
}

// адрес по координатам (OpenStreetMap), кратко
export async function reverseGeo(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=ru&zoom=18`, {
      headers: { "user-agent": "pikhal-malych-bot/1.0" }, signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const d = await res.json();
    const a = d.address ?? {};
    return [d.name, a.road, a.house_number, a.suburb ?? a.city_district, a.city ?? a.town ?? a.village]
      .filter(Boolean).filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i).join(", ") || String(d.display_name ?? "").slice(0, 150);
  } catch {
    return "";
  }
}

// заметки, записанные рядом с точкой
// deno-lint-ignore no-explicit-any
export async function notesNear(lat: number, lon: number): Promise<any[]> {
  const d = NEAR_M / 111_000; // грубый квадрат, потом точное расстояние
  const { data } = await supabase.from("pa_notes").select("id, kind, text, place, created_at, lat, lon")
    .gte("lat", lat - d).lte("lat", lat + d).gte("lon", lon - d * 1.5).lte("lon", lon + d * 1.5).limit(50);
  // deno-lint-ignore no-explicit-any
  return (data ?? []).filter((n: any) => distM({ lat, lon }, { lat: n.lat, lon: n.lon }) <= NEAR_M);
}

// пришла геолокация (разовая или живая): запомнить, и если рядом есть заметки — напомнить важное про это место
// deno-lint-ignore no-explicit-any
export async function paOnLocation(chatId: number, lat: number, lon: number, live: boolean, liveInfo?: { date: number; period: number }) {
  if (liveInfo) { // трансляция: запомнить, до когда идёт; при старте — убрать «Я здесь»
    const wasLive = await liveActive();
    const until = liveInfo.period >= 0x7fffffff ? Date.now() + 24 * 3600e3 : (liveInfo.date + liveInfo.period) * 1000;
    await supabase.from("pa_state").upsert({ key: "live", value: JSON.stringify({ until, last: Date.now() }) });
    if (!wasLive) await bot.api.sendMessage(chatId, "📡 Вижу трансляцию — кнопку «Я здесь» убрал, пока она идёт.", { reply_markup: { remove_keyboard: true } });
  }
  const prev = await paLastLoc(24 * 60);
  const place = prev && distM(prev, { lat, lon }) < 50 && prev.place ? prev.place : await reverseGeo(lat, lon);
  const known = placeNear(await allPlaces(), lat, lon); // знакомое место из ящика?
  await supabase.from("pa_state").upsert({ key: "last_loc", value: JSON.stringify({ lat, lon, place: known?.name ?? place, at: Date.now() }) });
  if (known) await supabase.from("pa_state").upsert({ key: "here_place", value: JSON.stringify({ id: known.id, name: known.name, at: Date.now() }) });
  else await supabase.from("pa_state").delete().eq("key", "here_place");
  const near = known ? await notesOfPlace(known) : await notesNear(lat, lon);
  if (near.length === 0) {
    if (!live) await bot.api.sendMessage(chatId, known
      ? `📍 Ты в «${known.name}». Заметок отсюда пока нет, следующий час всё привяжу сюда.`
      : `📍 Запомнил, где ты: ${place || `${lat.toFixed(5)}, ${lon.toFixed(5)}`}. Скажешь, как называется место, — запомню его.`);
    return;
  }
  // не дёргать чаще раза в 6 часов про одно и то же место
  const key = `near:${near.map((n) => n.id).sort().join(",")}`;
  const { data: seen } = await supabase.from("pa_state").select("value").eq("key", key).maybeSingle();
  if (live && seen && Date.now() - Number(seen.value) < 6 * 3600e3) return;
  await supabase.from("pa_state").upsert({ key, value: String(Date.now()) });
  const list = near.map((n) => `#${n.id} [${fmtAsh(n.created_at).slice(0, 10)}${n.place ? `, ${n.place}` : ""}] ${trunc(n.text, 500)}`).join("\n");
  const out = await geminiText(
    `Ты — личный ассистент ${ON.gen}. Он сейчас рядом с местом, про которое у него есть заметки. Коротко напомни только потенциально важное и полезное прямо сейчас: договорённости, долги, что надо сделать или забрать, с кем тут встречался. Списком, без воды. Если ничего важного — одной строкой перечисли, что тут было.`,
    [{ text: `Сейчас: ${ashNowText()}\nМесто: ${known?.name ?? place}${known?.facts ? `\nО месте: ${known.facts}` : ""}\nЗаметки рядом:\n${list}` }],
    { models: PA_MODELS_CHEAP, temperature: 0.2, maxTokens: 800, maxChars: 1500 },
  );
  await bot.api.sendMessage(chatId, `📍 ${known ? `Ты в «${known.name}»` : `Ты рядом с местом из заметок${place ? ` (${place})` : ""}`}:\n\n${out ?? list}`);
}

// --- ящик «места» ---
export const PLACE_NEAR_M = 150;

 // точка ближе — считаем, что это то же место
// deno-lint-ignore no-explicit-any
export async function allPlaces(): Promise<any[]> {
  const { data } = await supabase.from("pa_places").select("id, name, aliases, lat, lon, address, facts").limit(500);
  return data ?? [];
}

export const stemOf = (w: string) => w.toLowerCase().trim().slice(0, Math.max(3, w.trim().length - 2));

// найти место по названию/прозвищу (с учётом падежей)
// deno-lint-ignore no-explicit-any
export function placeByName(places: any[], name: string): any | null {
  const n = name.toLowerCase().trim();
  return places.find((p) => [p.name, ...(p.aliases ?? [])].some((x: string) => x.toLowerCase() === n)) ??
    places.find((p) => [p.name, ...(p.aliases ?? [])].some((x: string) => x.length >= 3 && n.includes(stemOf(x)))) ?? null;
}

// ближайшее знакомое место к точке
// deno-lint-ignore no-explicit-any
export function placeNear(places: any[], lat: number, lon: number): any | null {
  // deno-lint-ignore no-explicit-any
  let best: any = null, bestD = Infinity;
  for (const p of places) {
    if (p.lat == null) continue;
    const d = distM({ lat, lon }, { lat: p.lat, lon: p.lon });
    if (d < bestD) [best, bestD] = [p, d];
  }
  return bestD <= PLACE_NEAR_M ? best : null;
}

// создать/обновить место; если он сейчас там и есть свежая геометка — прописать координаты
// deno-lint-ignore no-explicit-any
export async function upsertPlace(name: string, fact: string, here: boolean): Promise<any> {
  let p = placeByName(await allPlaces(), name);
  const loc = here ? await paLastLoc(60) : null;
  if (!p) {
    const { data } = await supabase.from("pa_places").insert({
      name: trunc(name.trim(), 100), lat: loc?.lat ?? null, lon: loc?.lon ?? null, address: loc?.place ?? "",
      facts: fact ? `[${ashParts().date}] ${trunc(fact, 500)}` : "",
    }).select("id, name, aliases, lat, lon, address, facts").single();
    p = data;
  } else {
    const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (fact) upd.facts = `${p.facts}\n[${ashParts().date}] ${trunc(fact, 500)}`.trim();
    if (loc && p.lat == null) Object.assign(upd, { lat: loc.lat, lon: loc.lon, address: loc.place ?? "" });
    await supabase.from("pa_places").update(upd).eq("id", p.id);
  }
  if (here && p) { // «я здесь» словами: текущее место на час
    await supabase.from("pa_state").upsert({ key: "here_place", value: JSON.stringify({ id: p.id, name: p.name, at: Date.now() }) });
  }
  return p;
}

// текущее место: названное словами за час или знакомое место у свежей геометки
// deno-lint-ignore no-explicit-any
export async function currentPlace(): Promise<any | null> {
  const { data } = await supabase.from("pa_state").select("value").eq("key", "here_place").maybeSingle();
  if (data) {
    try {
      const o = JSON.parse(data.value);
      if (Date.now() - Number(o.at) <= 60 * 60e3) {
        const { data: p } = await supabase.from("pa_places").select("id, name, aliases, lat, lon, address, facts").eq("id", o.id).maybeSingle();
        if (p) return p;
      }
    } catch { /* ignore */ }
  }
  const loc = await paLastLoc(60);
  return loc ? placeNear(await allPlaces(), loc.lat, loc.lon) : null;
}

// заметки, привязанные к месту (по id или рядом по координатам)
// deno-lint-ignore no-explicit-any
export async function notesOfPlace(p: any): Promise<any[]> {
  const { data: byId } = await supabase.from("pa_notes").select("id, kind, text, place, created_at").eq("place_id", p.id).order("id", { ascending: false }).limit(15);
  const near = p.lat != null ? await notesNear(p.lat, p.lon) : [];
  const seen = new Set<number>();
  // deno-lint-ignore no-explicit-any
  return [...(byId ?? []), ...near].filter((n: any) => !seen.has(n.id) && !!seen.add(n.id)).slice(0, 15);
}

// --- ящик «Работа»: проекты, клиенты, места работы, поездки ---
export const WORK_KIND: Record<string, string> = { project: "проект", client: "клиент", job: "работа", trip: "поездка" };

export const WORK_STATUS: Record<string, string> = { idea: "идея", active: "в работе", paused: "на паузе", closed: "закрыт" };

// deno-lint-ignore no-explicit-any
export async function allWork(): Promise<any[]> {
  const { data } = await supabase.from("pa_work").select("id, name, aliases, kind, status, description, members").limit(300);
  return data ?? [];
}

// работа по названию/прозвищу, с учётом падежей
// deno-lint-ignore no-explicit-any
export function workByName(list: any[], name: string): any | null {
  const n = name.toLowerCase().trim();
  return list.find((w) => [w.name, ...(w.aliases ?? [])].some((x: string) => x.toLowerCase() === n)) ??
    list.find((w) => [w.name, ...(w.aliases ?? [])].some((x: string) => x.length >= 3 && n.includes(stemOf(x)))) ?? null;
}

// работы, упомянутые в тексте
// deno-lint-ignore no-explicit-any
export function workMentioned(list: any[], text: string): any[] {
  const t = text.toLowerCase();
  return list.filter((w) => [w.name, ...(w.aliases ?? [])].some((x: string) => x.length >= 3 && t.includes(stemOf(x))));
}

// id работы по названию; создать, если нет
export async function workId(name?: string): Promise<number | null> {
  if (!name || !name.trim()) return null;
  const w = workByName(await allWork(), name);
  if (w) return w.id;
  const { data } = await supabase.from("pa_work").insert({ name: trunc(name.trim(), 100) }).select("id").single();
  return data?.id ?? null;
}

// карточка работы: люди, открытые дела и обещания, деньги, доступы, документы, последние заметки
// deno-lint-ignore no-explicit-any
export async function workCard(w: any, full = true): Promise<string> {
  // deno-lint-ignore no-explicit-any
  const members = (w.members ?? []).map((m: any) => `${m.name} — ${m.role}${m.since ? ` (с ${m.since})` : ""}`).join("; ");
  const lines = [`${w.name} [${WORK_KIND[w.kind] ?? w.kind}, ${WORK_STATUS[w.status] ?? w.status}]${w.aliases?.length ? ` (он же: ${w.aliases.join(", ")})` : ""}`];
  if (w.description) lines.push(`Описание: ${trunc(w.description, 600)}`);
  if (members) lines.push(`Люди: ${members}`);
  if (!full) return lines.join("\n");
  const [tasks, proms, money, secs, docs, notes] = await Promise.all([
    supabase.from("pa_tasks").select("id, text").eq("work_id", w.id).eq("done", false).limit(20),
    supabase.from("pa_promises").select("id, who, person, text, due_at").eq("work_id", w.id).eq("done", false).limit(20),
    supabase.from("pa_money").select("person, amount, currency").eq("work_id", w.id),
    supabase.from("pa_secrets").select("label").eq("work_id", w.id),
    supabase.from("pa_docs").select("title").eq("work_id", w.id),
    supabase.from("pa_notes").select("id, text, created_at").eq("work_id", w.id).order("id", { ascending: false }).limit(8),
  ]);
  if (tasks.data?.length) lines.push("Дела: " + tasks.data.map((t) => `#${t.id} ${t.text}`).join("; "));
  if (proms.data?.length) lines.push("Обещания: " + proms.data.map((p) => `#${p.id} ${p.who === "me" ? "он" : p.person || "ему"}: ${p.text}${p.due_at ? ` до ${fmtAsh(p.due_at).slice(0, 10)}` : ""}`).join("; "));
  if (money.data?.length) {
    const sum = new Map<string, number>();
    money.data.forEach((m) => sum.set(m.currency, (sum.get(m.currency) ?? 0) + Number(m.amount)));
    lines.push("Деньги по работе (сумма операций): " + [...sum].map(([c, v]) => `${v} ${c}`).join(", "));
  }
  if (secs.data?.length) lines.push("Доступы: " + secs.data.map((x) => x.label).join("; "));
  if (docs.data?.length) lines.push("Документы: " + docs.data.map((x) => x.title).join("; "));
  if (notes.data?.length) lines.push("Последние заметки:\n" + notes.data.map((n) => `#${n.id} [${fmtAsh(n.created_at).slice(0, 10)}] ${trunc(n.text, 300)}`).join("\n"));
  return lines.join("\n");
}

// основное имя человека, если назвали по прозвищу
export async function canonicalName(name: string): Promise<string> {
  const n = name.trim();
  const { data } = await supabase.from("pa_people").select("name, aliases").limit(500);
  // deno-lint-ignore no-explicit-any
  const p = (data ?? []).find((x: any) => x.name.toLowerCase() === n.toLowerCase() ||
    (x.aliases ?? []).some((a: string) => a.toLowerCase() === n.toLowerCase()));
  return p ? p.name : n;
}

// --- деньги: балансы по людям и валютам ---
export async function moneyBalances(): Promise<string[]> {
  const { data } = await supabase.from("pa_money").select("person, amount, currency, note, created_at").order("id");
  const acc = new Map<string, { sum: number; last: string }>();
  for (const m of data ?? []) {
    const k = `${m.person}|${m.currency}`;
    const a = acc.get(k) ?? { sum: 0, last: "" };
    a.sum += Number(m.amount);
    a.last = `${fmtAsh(m.created_at).slice(0, 10)} ${m.note}`.trim();
    acc.set(k, a);
  }
  return [...acc.entries()].filter(([, a]) => Math.abs(a.sum) > 0.001).map(([k, a]) => {
    const [person, cur] = k.split("|");
    return `${person}: ${a.sum > 0 ? "+" : "−"}${Math.abs(a.sum)} ${cur} (${a.sum > 0 ? "должен тебе" : "ты должен"}; последнее: ${a.last})`;
  });
}

// --- нижняя клавиатура: «📍 Я здесь» (прячется, пока идёт трансляция) и кнопки подтверждения над ней ---
export async function liveActive(): Promise<boolean> {
  const { data } = await supabase.from("pa_state").select("value").eq("key", "live").maybeSingle();
  if (!data) return false;
  try {
    const o = JSON.parse(data.value);
    return Date.now() < Number(o.until) && Date.now() - Number(o.last) < 30 * 60e3; // идёт и обновлялась за 30 минут
  } catch {
    return false;
  }
}

// обычная клавиатура (или убрать, если идёт трансляция); extra — строки кнопок над «Я здесь»
export async function paKeyboard(extra: string[][] = []) {
  const live = await liveActive();
  if (!extra.length && live) return { remove_keyboard: true as const };
  const kb = new Keyboard();
  for (const row of extra) {
    row.forEach((t) => kb.text(t));
    kb.row();
  }
  if (!live) kb.requestLocation("📍 Я здесь");
  return kb.resized().persistent();
}

// спросить подтверждение кнопками внизу; options: подпись кнопки → действие
export async function askConfirm(chatId: number, question: string, options: { label: string; act: string }[]) {
  await supabase.from("pa_state").upsert({ key: "pending_confirm", value: JSON.stringify({ options, at: Date.now() }) });
  await bot.api.sendMessage(chatId, question, { reply_markup: await paKeyboard([...options.map((o) => [o.label]), ["Оставить"]]) });
}

// ответ на подтверждение: true — обработали
export async function handleConfirm(chatId: number, text: string): Promise<boolean> {
  const { data } = await supabase.from("pa_state").select("value").eq("key", "pending_confirm").maybeSingle();
  if (!data) return false;
  // deno-lint-ignore no-explicit-any
  let o: any;
  try {
    o = JSON.parse(data.value);
  } catch {
    return false;
  }
  if (Date.now() - Number(o.at) > 10 * 60e3) {
    await supabase.from("pa_state").delete().eq("key", "pending_confirm");
    return false;
  }
  const t = text.trim();
  // deno-lint-ignore no-explicit-any
  const opt = (o.options ?? []).find((x: any) => x.label === t);
  if (!opt && t !== "Оставить") return false;
  await supabase.from("pa_state").delete().eq("key", "pending_confirm");
  let msg = "Оставил как есть.";
  if (opt) {
    const [kind, idStr] = String(opt.act).split(":");
    const ids = idStr.split(",").map(Number).filter(Boolean);
    const id = ids[0];
    if (kind === "secdel") {
      const { data: secs } = await supabase.from("pa_secrets").select("label").in("id", ids);
      await supabase.from("pa_secrets").delete().in("id", ids);
      msg = secs?.length ? `🗑 Удалил доступы: ${secs.map((x) => x.label).join(", ")}` : "Уже удалено.";
    } else if (kind === "docdel") {
      const { data: ds } = await supabase.from("pa_docs").select("id, title").in("id", ids);
      const { data: files } = await supabase.from("pa_doc_files").select("path").in("doc_id", ids);
      if (files?.length) await supabase.storage.from("pa-docs").remove(files.map((f) => f.path));
      await supabase.from("pa_docs").delete().in("id", ids);
      msg = ds?.length ? `🗑 Удалил со сканами: ${ds.map((d) => d.title).join(", ")}` : "Уже удалено.";
    } else if (kind === "notedel") {
      await supabase.from("pa_notes").delete().in("id", ids);
      msg = `🗑 Удалил заметок: ${ids.length}`;
    }
  }
  await bot.api.sendMessage(chatId, msg, { reply_markup: await paKeyboard() });
  return true;
}

// --- контекст памяти для запроса ---
export async function paMemory(query: string): Promise<{ text: string; noteIds: Set<number> }> {
  const parts: string[] = [`Сейчас: ${ashNowText()}`];
  const here = await paLastLoc(60);
  if (here) {
    parts.push(`Он сейчас (по геолокации за последний час): ${here.place || `${here.lat.toFixed(5)}, ${here.lon.toFixed(5)}`}`);
    const near = await notesNear(here.lat, here.lon);
    // deno-lint-ignore no-explicit-any
    if (near.length) parts.push("Заметки об этом месте:\n" + near.slice(0, 10).map((n: any) => `#${n.id} [${fmtAsh(n.created_at).slice(0, 10)}] ${trunc(n.text, 500)}`).join("\n"));
  }
  const places = await allPlaces();
  if (places.length) parts.push("Места (все): " + places.map((p) => p.name + (p.aliases?.length ? ` [он же: ${p.aliases.join(", ")}]` : "")).join(", "));
  // место, названное в сообщении, и место, где он сейчас
  const ql = query.toLowerCase();
  const named = places.filter((p) => [p.name, ...(p.aliases ?? [])].some((x: string) => x.length >= 3 && ql.includes(stemOf(x))));
  const cur = await currentPlace();
  for (const p of [...(cur ? [cur] : []), ...named.filter((x) => x.id !== cur?.id)].slice(0, 3)) {
    const ns = await notesOfPlace(p);
    parts.push(`${p.id === cur?.id ? "Он сейчас здесь" : "Упомянуто место"}: ${p.name}${p.address ? ` (${p.address})` : ""}${p.facts ? `\nО месте: ${trunc(p.facts, 600)}` : ""}` +
      // deno-lint-ignore no-explicit-any
      (ns.length ? "\nЗаметки об этом месте:\n" + ns.map((n: any) => `#${n.id} [${fmtAsh(n.created_at).slice(0, 10)}] ${trunc(n.text, 400)}`).join("\n") : ""));
  }
  const bal = await moneyBalances();
  if (bal.length) parts.push("Деньги (баланс по людям; + ему должны, − он должен):\n" + bal.join("\n"));
  const { data: rem } = await supabase.from("pa_reminders").select("id, text, due_at, repeat")
    .eq("done", false).order("due_at").limit(25);
  // deno-lint-ignore no-explicit-any
  parts.push("Активные напоминания:\n" + ((rem ?? []).map((r: any) => `#${r.id} ${fmtAsh(r.due_at)} — ${r.text}${r.repeat ? ` [${r.repeat}]` : ""}`).join("\n") || "(нет)"));
  const { data: people } = await supabase.from("pa_people").select("name, facts, aliases").order("updated_at", { ascending: false }).limit(300);
  const q = query.toLowerCase();
  // упомянут по имени или по прозвищу (с учётом падежей: сравниваем основу)
  const hit = (w: string) => {
    const base = w.toLowerCase().replace(/\s*\(.*\)\s*/, "").trim();
    return base.length >= 3 && q.includes(base.slice(0, Math.max(3, base.length - 2)));
  };
  // deno-lint-ignore no-explicit-any
  const mentioned = (people ?? []).filter((p: any) => hit(p.name) || (p.aliases ?? []).some(hit));
  // deno-lint-ignore no-explicit-any
  parts.push("Люди (все): " + ((people ?? []).map((p: any) => p.name + (p.aliases?.length ? ` [он же: ${p.aliases.join(", ")}]` : "")).join(", ") || "(никого)"));
  if (mentioned.length) {
    // deno-lint-ignore no-explicit-any
    parts.push("Карточки упомянутых:\n" + mentioned.slice(0, 8).map((p: any) => `${p.name}: ${trunc(p.facts, 1200)}`).join("\n"));
  }
  const noteIds = new Set<number>();
  const qe = await embed(query);
  if (qe) {
    const { data: notes } = await supabase.rpc("pa_match_notes", { q: JSON.stringify(qe), k: 10 });
    // deno-lint-ignore no-explicit-any
    const rel = (notes ?? []).filter((n: any) => n.score > 0.45);
    // deno-lint-ignore no-explicit-any
    rel.forEach((n: any) => noteIds.add(Number(n.id)));
    // deno-lint-ignore no-explicit-any
    parts.push("Похожие заметки:\n" + (rel.map((n: any) => `#${n.id} [${n.kind}, записано ${fmtAsh(n.created_at).slice(0, 10)}${n.place ? `, место: ${n.place}` : ""}] ${trunc(n.text, 700)}`).join("\n") || "(нет)"));
  }
  // свежее за сутки — всегда, даже если не похоже на новое сообщение
  const { data: fresh } = await supabase.from("pa_notes").select("id, kind, text, place, created_at")
    .gte("created_at", new Date(Date.now() - 864e5).toISOString()).order("id", { ascending: false }).limit(15);
  // deno-lint-ignore no-explicit-any
  const freshNew = (fresh ?? []).filter((n: any) => !noteIds.has(Number(n.id)));
  // deno-lint-ignore no-explicit-any
  if (freshNew.length) parts.push("Записано за последние сутки:\n" + freshNew.map((n: any) => `#${n.id} [${n.kind}, ${fmtAsh(n.created_at)}${n.place ? `, ${n.place}` : ""}] ${trunc(n.text, 400)}`).join("\n"));
  const works = await allWork();
  if (works.length) parts.push("Работа (все): " + works.map((w) => `${w.name} [${WORK_KIND[w.kind] ?? w.kind}, ${WORK_STATUS[w.status] ?? w.status}]`).join("; "));
  for (const w of workMentioned(works, query).slice(0, 3)) parts.push("Упомянута работа:\n" + await workCard(w));
  const cts = await contactsMentioned(query);
  if (cts.length) {
    parts.push("Телефонная книжка (совпадения по именам в сообщении):\n" + cts.map((c) => `${c.name}${c.org ? ` (${c.org})` : ""}: ${c.phones.join(", ")}${c.note ? ` — ${trunc(c.note, 100)}` : ""}`).join("\n"));
  }
  const { data: prom } = await supabase.from("pa_promises").select("id, who, person, text, due_at").eq("done", false).order("id").limit(40);
  // deno-lint-ignore no-explicit-any
  parts.push("Открытые обещания:\n" + ((prom ?? []).map((p: any) => `#${p.id} ${p.who === "me" ? "он обещал" : "ему обещал"}${p.person ? ` ${p.person}` : ""}: ${p.text}${p.due_at ? ` (срок ${fmtAsh(p.due_at)})` : ""}`).join("\n") || "(нет)"));
  const { data: tasks } = await supabase.from("pa_tasks").select("id, text").eq("done", false).order("id").limit(40);
  // deno-lint-ignore no-explicit-any
  parts.push("Открытые дела:\n" + ((tasks ?? []).map((t: any) => `#${t.id} ${t.text}`).join("\n") || "(нет)"));
  const { data: docs } = await supabase.from("pa_docs").select("id, title, expires_on").order("id");
  // deno-lint-ignore no-explicit-any
  parts.push("Документы (сканы зашифрованы, выдаёт /docs): " + ((docs ?? []).map((d: any) => `${d.title}${d.expires_on ? ` (до ${d.expires_on.split("-").reverse().join(".")})` : ""}`).join("; ") || "(нет)"));
  const { data: secrets } = await supabase.from("pa_secrets").select("label").order("id");
  // deno-lint-ignore no-explicit-any
  parts.push("Сохранённые доступы (только названия): " + ((secrets ?? []).map((s: any, i: number) => `${i + 1}. ${s.label}`).join("; ") || "(нет)"));
  const { data: hist } = await supabase.from("pa_history").select("role, text").order("id", { ascending: false }).limit(20);
  // deno-lint-ignore no-explicit-any
  parts.push("Недавний диалог:\n" + ((hist ?? []).reverse().map((h: any) => `${h.role === "user" ? "Он" : "Ты"}: ${trunc(h.text, 400)}`).join("\n") || "(пусто)"));
  return { text: parts.join("\n\n"), noteIds };
}

// следующая дата повторяющегося напоминания
export function nextDue(d: Date, repeat: string): Date | null {
  const n = new Date(d);
  if (repeat === "daily") n.setUTCDate(n.getUTCDate() + 1);
  else if (repeat === "weekly") n.setUTCDate(n.getUTCDate() + 7);
  else if (repeat === "monthly") n.setUTCMonth(n.getUTCMonth() + 1);
  else if (repeat === "yearly") n.setUTCFullYear(n.getUTCFullYear() + 1);
  else return null;
  return n;
}

// выполнить действия из ответа Gemini; возвращает строки-подтверждения
// deno-lint-ignore no-explicit-any
export async function paApply(actions: any[], ctxInfo: { fileId?: string; source?: string; noteIds: Set<number>; chatId?: number }): Promise<string[]> {
  const done: string[] = [];
  // сначала места (чтобы заметки привязались к ним), потом остальное
  actions = [...(actions ?? [])].sort((x, y) => (x?.type === "place" || x?.type === "work" ? 0 : 1) - (y?.type === "place" || y?.type === "work" ? 0 : 1));
  const worksNow = await allWork();
  for (const a of actions ?? []) {
    // лёгкие модели путают поля: привязку к работе ищем и в тексте записи, имя партнёра — в соседних полях
    if (!a.work && a.type !== "work" && a.text) {
      const wm = workMentioned(worksNow, String(a.text));
      if (wm.length === 1) a.work = wm[0].name;
    }
    if (a.type === "work_member") {
      a.name = a.name || a.label || (Array.isArray(a.people) ? a.people[0] : "") || "";
      if (!a.fact && a.text) a.fact = a.text;
    }
    try {
      if (a.type === "work" && a.name) {
        const list = await allWork();
        const w = workByName(list, a.name);
        const kind = ["project", "client", "job", "trip"].includes(a.kind) ? a.kind : undefined;
        const status = ["idea", "active", "paused", "closed"].includes(a.status) ? a.status : undefined;
        if (!w) {
          await supabase.from("pa_work").insert({ name: trunc(a.name.trim(), 100), kind: kind ?? "project", status: status ?? "active", description: trunc(a.text ?? "", 2000) });
          done.push(`💼 ${a.name}${kind ? ` (${WORK_KIND[kind]})` : ""}`);
        } else {
          const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (kind) upd.kind = kind;
          if (status) upd.status = status;
          if (a.text) upd.description = trunc(`${w.description}\n[${ashParts().date}] ${a.text}`.trim(), 4000);
          await supabase.from("pa_work").update(upd).eq("id", w.id);
          done.push(`💼 ${w.name}${status ? ` → ${WORK_STATUS[status]}` : ""}`);
        }
      } else if (a.type === "work_member" && a.work && !a.name) {
        done.push(`⚠️ не понял, кто в «${a.work}»`);
      } else if (a.type === "work_member" && a.work && a.name) {
        a.fact = a.fact || "участник";
        const id = await workId(a.work);
        const { data: w } = await supabase.from("pa_work").select("name, members").eq("id", id).single();
        const nm = await canonicalName(a.name);
        // deno-lint-ignore no-explicit-any
        const members = (w?.members ?? []).filter((m: any) => m.name.toLowerCase() !== nm.toLowerCase());
        members.push({ name: nm, role: trunc(a.fact, 200), since: ashParts().date });
        await supabase.from("pa_work").update({ members, updated_at: new Date().toISOString() }).eq("id", id);
        done.push(`💼 ${w?.name}: ${nm} — ${trunc(a.fact, 50)}`);
      } else if (a.type === "forget_topic" && a.text && ctxInfo.chatId) {
        // заметки по теме: смысловой поиск + слова в тексте; удаление — только после подтверждения
        const e = await embed(a.text);
        const { data: sim } = e ? await supabase.rpc("pa_match_notes", { q: JSON.stringify(e), k: 30 }) : { data: [] };
        const stems = String(a.text).toLowerCase().split(/[^а-яёa-z0-9]+/i).filter((w: string) => w.length >= 4).map((w: string) => w.slice(0, w.length - 2));
        // deno-lint-ignore no-explicit-any
        const hits = (sim ?? []).filter((n: any) => n.score > 0.62 || stems.some((st: string) => n.text.toLowerCase().includes(st)));
        if (!hits.length) {
          done.push(`🔍 заметок про «${trunc(a.text, 40)}» не нашёл`);
        } else {
          await askConfirm(ctxInfo.chatId, `Нашёл заметки про «${a.text}»:\n` +
            // deno-lint-ignore no-explicit-any
            hits.slice(0, 15).map((n: any) => `• ${fmtAsh(n.created_at).slice(0, 10)} ${trunc(n.text, 90)}`).join("\n") +
            (hits.length > 15 ? `\n…и ещё ${hits.length - 15}` : "") + "\nУдалить все? Вернуть будет нельзя.",
            // deno-lint-ignore no-explicit-any
            [{ label: `🗑 Удалить заметки (${hits.length})`, act: `notedel:${hits.map((n: any) => n.id).join(",")}` }]);
          done.push("❓ жду подтверждение внизу");
        }
      } else if (a.type === "promise" && a.text) {
        const due = a.due ? new Date(a.due) : null;
        await supabase.from("pa_promises").insert({
          work_id: await workId(a.work),
          who: a.who === "me" ? "me" : "them", person: a.name ? await canonicalName(a.name) : "",
          text: trunc(a.text, 800), due_at: due && !isNaN(due.getTime()) ? due.toISOString() : null,
        });
        done.push(`🤝 ${a.who === "me" ? "ты обещал" : "тебе обещали"}${due && !isNaN(due.getTime()) ? ` до ${fmtAsh(due)}` : ""}`);
      } else if (a.type === "promise_done" && a.id) {
        await supabase.from("pa_promises").update({ done: true }).eq("id", a.id);
        done.push(`✅ обещание #${a.id}`);
      } else if (a.type === "task" && a.text) {
        await supabase.from("pa_tasks").insert({ text: trunc(a.text, 500), work_id: await workId(a.work) });
        done.push(`☑️ дело: ${trunc(a.text, 60)}`);
      } else if (a.type === "task_done" && a.id) {
        await supabase.from("pa_tasks").update({ done: true, done_at: new Date().toISOString() }).eq("id", a.id);
        done.push(`✅ дело #${a.id}`);
      } else if (a.type === "doc_start" && (a.label || a.text)) {
        const d = await startDoc(a.label || a.text, a.due);
        done.push(`🗂 жду сканы: ${d.title}${d.expires_on ? ` (до ${d.expires_on.split("-").reverse().join(".")})` : ""}`);
      } else if (a.type === "place" && a.name) {
        const p = await upsertPlace(a.name, a.text ?? "", !!a.here);
        if (p) done.push(`📍 ${p.name}${a.here ? " — ты здесь" : ""}`);
      } else if (a.type === "note" && a.text) {
        const e = await embed(a.text);
        const loc = await paLastLoc(60); // если делился геолокацией за последний час
        // место: названное в заметке, иначе текущее
        const p = a.place ? await upsertPlace(a.place, "", false) : await currentPlace();
        await supabase.from("pa_notes").insert({
          kind: a.kind || (ctxInfo.fileId ? "screenshot" : "note"), text: trunc(a.text, 4000),
          source: ctxInfo.source ?? null, people: a.people ?? [], file_id: ctxInfo.fileId ?? null,
          embedding: e ? JSON.stringify(e) : null,
          lat: p?.lat ?? loc?.lat ?? null, lon: p?.lon ?? loc?.lon ?? null,
          place: p?.name ?? (loc?.place || null), place_id: p?.id ?? null, work_id: await workId(a.work),
        });
        done.push("📝 записал");
      } else if (a.type === "remind" && a.text && !a.due) {
        done.push(`⚠️ не понял дату для «${trunc(a.text, 60)}»`);
      } else if (a.type === "remind" && a.text && a.due) {
        const due = new Date(a.due);
        if (isNaN(due.getTime()) || due.getTime() < Date.now() - 60e3) {
          done.push(`⚠️ не понял дату для «${trunc(a.text, 60)}»`);
          continue;
        }
        const repeat = ["daily", "weekly", "monthly", "yearly"].includes(a.repeat) ? a.repeat : null;
        await supabase.from("pa_reminders").insert({ text: trunc(a.text, 1000), due_at: due.toISOString(), repeat, prep: !!a.prep, work_id: await workId(a.work) });
        done.push(`⏰ ${fmtAsh(due)}${repeat ? ` (${{ daily: "каждый день", weekly: "каждую неделю", monthly: "каждый месяц", yearly: "каждый год" }[repeat as string]})` : ""}`);
      } else if (a.type === "person" && a.name && a.fact) {
        const name = trunc(await canonicalName(a.name.trim()), 100);
        const { data: p } = await supabase.from("pa_people").select("id, facts").ilike("name", name).maybeSingle();
        const line = `[${ashParts().date}] ${trunc(a.fact, 500)}`;
        if (p) await supabase.from("pa_people").update({ facts: `${p.facts}\n${line}`.trim(), updated_at: new Date().toISOString() }).eq("id", p.id);
        else await supabase.from("pa_people").insert({ name, facts: line });
        done.push(`👤 ${name}`);
      } else if (a.type === "alias" && a.name && a.fact) {
        const main = a.name.trim(), alias = trunc(a.fact.trim(), 60);
        let { data: p } = await supabase.from("pa_people").select("id, facts, aliases").ilike("name", main).maybeSingle();
        if (!p) {
          await supabase.from("pa_people").insert({ name: trunc(main, 100), facts: "" });
          ({ data: p } = await supabase.from("pa_people").select("id, facts, aliases").ilike("name", main).maybeSingle());
        }
        // если была отдельная карточка на прозвище — переносим факты и удаляем её
        const { data: dup } = await supabase.from("pa_people").select("id, name, facts, aliases").ilike("name", alias).maybeSingle();
        let facts = p!.facts;
        const aliases = new Set<string>([...(p!.aliases ?? []), alias]);
        if (dup && dup.id !== p!.id) {
          facts = `${facts}\n${dup.facts}`.trim();
          (dup.aliases ?? []).forEach((x: string) => aliases.add(x));
          await supabase.from("pa_people").delete().eq("id", dup.id);
        }
        await supabase.from("pa_people").update({ facts, aliases: [...aliases], updated_at: new Date().toISOString() }).eq("id", p!.id);
        await supabase.from("pa_money").update({ person: main }).ilike("person", alias); // долги прозвища — на основное имя
        done.push(`🔗 ${alias} = ${main}`);
      } else if (a.type === "forget_note" && a.id) {
        await supabase.from("pa_notes").delete().eq("id", a.id);
        done.push(`🗑 заметка #${a.id}`);
      } else if (a.type === "forget_person" && a.name) {
        await supabase.from("pa_people").delete().ilike("name", a.name.trim());
        done.push(`🗑 ${a.name}`);
      } else if (a.type === "cancel_reminder" && a.id) {
        await supabase.from("pa_reminders").update({ done: true }).eq("id", a.id);
        done.push(`🗑 напоминание #${a.id}`);
      } else if (a.type === "money" && a.name && typeof a.amount === "number" && a.amount !== 0) {
        a.name = await canonicalName(a.name);
        const cur = String(a.currency || "TMT").toUpperCase().slice(0, 5);
        await supabase.from("pa_money").insert({ person: trunc(a.name.trim(), 100), amount: a.amount, currency: cur, note: trunc(a.text ?? "", 300), work_id: await workId(a.work) });
        done.push(`💰 ${a.name}: ${a.amount > 0 ? "+" : "−"}${Math.abs(a.amount)} ${cur}`);
      } else if (a.type === "secret_start" && a.label) {
        await paSetPending(trunc(a.label, 200));
        done.push(`🔐 жду следующим сообщением: ${trunc(a.label, 80)}`);
      }
    } catch (e) {
      console.error("pa action failed", a?.type, e);
    }
  }
  return done;
}

// главный обработчик лички создателя (в фоне)
// deno-lint-ignore no-explicit-any
export async function paHandle(ctx: any) {
  const chatId = ctx.chat.id;
  const msg = ctx.msg;
  let text = (msg.text ?? msg.caption ?? "").trim();
  const origin = msg.forward_origin;
  const source = origin
    ? `переслано от ${origin.sender_user?.first_name ?? origin.sender_user_name ?? origin.chat?.title ?? "кого-то"}`
    : undefined;
  // deno-lint-ignore no-explicit-any
  const parts: any[] = [];
  let fileId: string | undefined;
  let heard = "";

  // телефонная книжка: файл .vcf или контакт — без нейросети
  const docName = String(msg.document?.file_name ?? "").toLowerCase();
  if (msg.document && (docName.endsWith(".vcf") || /vcard/i.test(msg.document.mime_type ?? ""))) {
    const bytes = await tgDownload(msg.document.file_id);
    if (!bytes) return void (await bot.api.sendMessage(chatId, "Не смог скачать файл."));
    const list = parseVcf(new TextDecoder().decode(bytes));
    const n = await importContacts(list);
    await bot.api.sendMessage(chatId, `📇 Контактов в файле: ${list.length}, новых записал: ${n}. Искать — /contacts имя.`);
    await bot.api.deleteMessage(chatId, msg.message_id).catch(() => {});
    return;
  }
  if (msg.contact) {
    const c = msg.contact;
    const nm = [c.first_name, c.last_name].filter(Boolean).join(" ");
    await importContacts([{ name: nm, phones: [String(c.phone_number).replace(/[^\d+]/g, "")], emails: [], org: "", note: text, tg_user_id: c.user_id }]);
    await bot.api.sendMessage(chatId, `📇 Записал: ${nm}, ${c.phone_number}`);
    return;
  }

  // голосовое / кружок / аудио → текст
  const voice = msg.voice ?? msg.audio ?? msg.video_note;
  if (voice) {
    if ((voice.file_size ?? 0) > 18_000_000) {
      await bot.api.sendMessage(chatId, "Слишком длинное голосовое, не осилю.");
      return;
    }
    const t = await paTranscribe(voice.file_id, voice.mime_type ?? (msg.video_note ? "video/mp4" : "audio/ogg"));
    if (!t) {
      await bot.api.sendMessage(chatId, "Не смог расшифровать голосовое.");
      return;
    }
    heard = t;
    text = (text ? text + "\n" : "") + t;
  }
  // скриншот / фото / картинка файлом
  const photo = msg.photo ? msg.photo[msg.photo.length - 1] : null;
  const imgDoc = msg.document && String(msg.document.mime_type ?? "").startsWith("image/") ? msg.document : null;
  if (photo || imgDoc) {
    fileId = (photo ?? imgDoc).file_id;
    const bytes = await tgDownload(fileId!);
    if (bytes) parts.push({ inline_data: { mime_type: imgDoc?.mime_type ?? "image/jpeg", data: encodeBase64(bytes) } });
  }
  if (!text && parts.length === 0) return;

  // ответ кнопкой на подтверждение
  if (parts.length === 0 && !source && text && (await handleConfirm(chatId, text))) return;

  // пароли/доступы и документы — сами, без нейросети
  if (parts.length === 0 && !source) {
    const docLabel = docStartLabel(text);
    if (docLabel) {
      const d = await startDoc(docLabel);
      await bot.api.sendMessage(chatId, `🗂 Жду сканы или фото: ${d.title}${d.expires_on ? ` (до ${d.expires_on.split("-").reverse().join(".")}, напомню за месяц и за неделю)` : ""}.\nОни пойдут мимо нейросети, зашифрую и удалю из чата. Когда всё — «готово».`);
      return;
    }
    const label = secretStartLabel(text);
    if (label) {
      await paSetPending(label);
      await bot.api.sendMessage(chatId, `🔐 Жду следующим сообщением: ${label}\nОно пойдёт мимо нейросети, я его зашифрую и удалю из чата. Передумал — «отмена».\n(Совет: называй с клиентом или проектом — «сервер БД для проекта Альфа» — тогда потом «дай все доступы по Альфе».)`);
      return;
    }
    // удаление доступа/документа словами — с подтверждением кнопками
    const delQ = secretDeleteQuery(text);
    if (delQ || /^(?:удали|сотри|забудь)\s+(?:пароль|доступ|ключ|токен)$/i.test(text)) {
      const found = delQ ? await findSecrets(delQ) : [];
      if (found.length) {
        const opts = found.slice(0, 8).map((f) => ({ label: `🗑 ${trunc(f.label, 40)}`, act: `secdel:${f.id}` }));
        if (found.length > 1) opts.unshift({ label: `🗑 Удалить все (${found.length})`, act: `secdel:${found.map((f) => f.id).join(",")}` });
        await askConfirm(chatId, found.length === 1 ? `Удалить доступ «${found[0].label}»? Вернуть будет нельзя.`
          : `Нашёл доступы:\n${found.map((f) => `• ${f.label}`).join("\n")}\nУдалить все или какой-то один? Вернуть будет нельзя.`, opts);
      } else await bot.api.sendMessage(chatId, "Не нашёл такой доступ. Список — /pass.");
      return;
    }
    const docQ = docDeleteQuery(text);
    // документов со сканами по теме нет — пусть модель поищет заметки (forget_topic)
    const docHitAny = docQ ? ((await supabase.from("pa_docs").select("title")).data ?? []).some((d) =>
      docQ.toLowerCase().split(/[^а-яёa-z0-9]+/i).filter((w) => w.length >= 3).some((w) => d.title.toLowerCase().includes(w.slice(0, Math.max(3, w.length - 2))))) : false;
    if (docQ && docHitAny) {
      const { data: docs } = await supabase.from("pa_docs").select("id, title").order("id");
      const stems = docQ.toLowerCase().split(/[^а-яёa-z0-9]+/i).filter((w) => w.length >= 3).map((w) => w.slice(0, Math.max(3, w.length - 2)));
      const hit = (docs ?? []).filter((d) => stems.some((st) => d.title.toLowerCase().includes(st)));
      if (hit.length === 0) return void (await bot.api.sendMessage(chatId, "Не нашёл такой документ. Список — /docs."));
      const opts = hit.slice(0, 8).map((d) => ({ label: `🗑 ${trunc(d.title, 40)}`, act: `docdel:${d.id}` }));
      if (hit.length > 1) opts.unshift({ label: `🗑 Удалить все (${hit.length})`, act: `docdel:${hit.map((d) => d.id).join(",")}` });
      await askConfirm(chatId, hit.length === 1 ? `Удалить «${hit[0].title}» со всеми сканами? Вернуть будет нельзя.`
        : `Нашёл документы:\n${hit.map((d) => `• ${d.title}`).join("\n")}\nУдалить все или какой-то один? Вернуть будет нельзя.`, opts);
      return;
    }
    const ask = secretAskQuery(text);
    if (ask !== "" || /^(?:дай|покажи|скинь|выдай|пришли)\s+(?:мне\s+)?(?:пароль|доступ|ключ|токен)$/i.test(text)) {
      const found = ask ? await findSecrets(ask) : [];
      if (found.length >= 1 && found.length <= 10) {
        if (found.length > 1) await bot.api.sendMessage(chatId, `🔐 Нашёл ${found.length}, присылаю все (каждое удалю через минуту):`);
        for (const f of found) await sendSecret(chatId, f);
      } else if (found.length > 10) await bot.api.sendMessage(chatId, `Подходит ${found.length} — слишком много, уточни:\n` + found.slice(0, 30).map((s) => `• ${s.label}`).join("\n"));
      else await bot.api.sendMessage(chatId, "Не нашёл такой доступ. Список — /pass.");
      return;
    }
  }

  const mem = await paMemory(text || "скриншот");
  const newMsg = heard
    ? `Новое сообщение (голосовое, расшифровка): «${trunc(text, 5000)}»`
    : `Новое сообщение${source ? ` (${source})` : ""}${fileId ? " (прислал картинку/скриншот — она приложена)" : ""}: «${trunc(text, 5000) || "(без подписи)"}»`;
  parts.push({ text: `${mem.text}\n\n${newMsg}` });
  const simple = paIsSimple(text, !!fileId, !!heard);
  const raw = await geminiText(PA_SYSTEM, parts, {
    models: simple ? PA_MODELS_CHEAP : PA_MODELS, json: PA_SCHEMA, temperature: 0.6, maxTokens: 4000, timeoutMs: 25_000, deadlineMs: 55_000,
    thinking: "medium", accept: paOutputOk,
  });
  if (!raw) {
    await bot.api.sendMessage(chatId, "Модели сейчас не отвечают (перегружены или лимит). Повтори чуть позже — ничего не сохранил.");
    return;
  }
  // deno-lint-ignore no-explicit-any
  let o: any;
  try {
    o = JSON.parse(raw);
  } catch {
    o = { reply: raw, actions: [] };
  }
  const done = await paApply(o.actions ?? [], { fileId, source, noteIds: mem.noteIds, chatId });
  let reply = String(o.reply ?? "").trim();
  if (heard) reply = `🎙 ${trunc(heard, 300)}\n\n${reply}`;
  if (done.length) reply += (reply ? "\n\n" : "") + done.join("\n");
  if (reply) await bot.api.sendMessage(chatId, trunc(reply, 4000), { reply_markup: await paKeyboard() });
  const alert = String(o.alert ?? "").trim();
  if (alert) await bot.api.sendMessage(chatId, `⚠️ ${trunc(alert, 1500)}`);
  await supabase.from("pa_history").insert([
    { role: "user", text: trunc((fileId ? "[скриншот] " : "") + (heard ? "[голосовое] " : "") + (text || ""), 2000) },
    { role: "bot", text: trunc(reply + (alert ? `\n⚠️ ${alert}` : ""), 2000) },
  ]);
}

// ---------- телефонная книжка ----------
// разобрать .vcf (iPhone/Android): свёрнутые строки, QUOTED-PRINTABLE (Android пишет так кириллицу)
export function parseVcf(text: string): { name: string; phones: string[]; emails: string[]; org: string; note: string }[] {
  const unfolded = text.replace(/\r\n/g, "\n").replace(/=\n/g, "").replace(/\n[ \t]/g, "");
  const qp = (v: string) => {
    try {
      const bytes = v.replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
      return new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0)));
    } catch {
      return v;
    }
  };
  const out = [];
  for (const card of unfolded.split(/BEGIN:VCARD/i).slice(1)) {
    let name = "", n = "", org = "", note = "";
    const phones: string[] = [], emails: string[] = [];
    for (const line of card.split("\n")) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const head = line.slice(0, i).toUpperCase(), raw = line.slice(i + 1).trim();
      const val = head.includes("QUOTED-PRINTABLE") ? qp(raw) : raw.replace(/\\,/g, ",").replace(/\;/g, ";");
      const key = head.split(";")[0].replace(/^ITEM\d+\./, "");
      if (key === "FN") name = val;
      else if (key === "N") n = val.split(";").slice(0, 2).reverse().filter(Boolean).join(" ");
      else if (key === "TEL") phones.push(val.replace(/[^\d+]/g, ""));
      else if (key === "EMAIL") emails.push(val);
      else if (key === "ORG") org = val.replace(/;+$/, "").replace(/;/g, ", ");
      else if (key === "NOTE") note = val;
    }
    const nm = (name || n || org).trim();
    if (nm && (phones.length || emails.length)) out.push({ name: nm, phones: [...new Set(phones.filter(Boolean))], emails, org, note });
  }
  return out;
}

export async function importContacts(list: { name: string; phones: string[]; emails: string[]; org: string; note: string; tg_user_id?: number }[]): Promise<number> {
  // дубли отсекаем сами: имя + первый номер
  const { data: have } = await supabase.from("pa_contacts").select("name, phones").limit(20000);
  const key = (name: string, phones: string[]) => `${name.toLowerCase()}|${phones[0] ?? ""}`;
  const seen = new Set((have ?? []).map((c) => key(c.name, c.phones ?? [])));
  const fresh = list.map((c) => ({ ...c, name: trunc(c.name, 120), note: trunc(c.note, 500) }))
    .filter((c) => !seen.has(key(c.name, c.phones)) && !!seen.add(key(c.name, c.phones)));
  let n = 0;
  for (let i = 0; i < fresh.length; i += 300) {
    const { error } = await supabase.from("pa_contacts").insert(fresh.slice(i, i + 300));
    if (error) console.error("contacts insert failed", error);
    else n += Math.min(300, fresh.length - i);
  }
  return n;
}

// контакты, чьё имя/фамилия/организация упомянуты в тексте
// deno-lint-ignore no-explicit-any
export async function contactsMentioned(text: string): Promise<any[]> {
  const words = text.toLowerCase().split(/[^а-яёa-z0-9]+/i).filter((w) => w.length >= 3);
  if (!words.length) return [];
  const stems = [...new Set(words.map((w) => w.slice(0, Math.max(3, w.length - 2))))].slice(0, 12);
  const or = stems.map((st) => `name.ilike.%${st.replace(/[%,()]/g, "")}%`).join(",");
  const { data } = await supabase.from("pa_contacts").select("name, phones, org, note").or(or).limit(25);
  return data ?? [];
}

// ---------- документы: сканы шифруются тем же ключом и лежат в приватном хранилище pa-docs ----------
// «сохрани паспорт», «сохрани скан прав, действуют до 12.05.2030» — распознаём сами
export function docStartLabel(text: string): string {
  const m = text.trim().match(/^(?:сохрани|запомни|спрячь|храни)(?:те)?\s+(?:мне\s+)?(?:скан\S*\s+|фото\s+|копи\S*\s+)?((?:паспорт|загран|документ|прав(?:а|ах)?(?![а-яё])|водительск|удостоверени|свидетельств|страховк|полис|диплом|аттестат|договор|справк|виз[ау]|снилс|инн|техпаспорт|птс|id\b|айди)[\s\S]*)$/i);
  return m ? m[1].trim() : "";
}

// дата «до 12.05.2030» из текста
export function parseDateRu(text: string): string | null {
  const m = text.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
}

// завести документ (или найти существующий по названию), ждать сканы; напоминания об окончании срока
// deno-lint-ignore no-explicit-any
export async function startDoc(label: string, due?: string): Promise<any> {
  const title = trunc(label.replace(/[,;]?\s*(действ\S*\s+)?до\s+\d{1,2}[.\/]\d{1,2}[.\/]\d{4}.*$/i, "").trim() || label, 120);
  const exp = (due && !isNaN(new Date(due).getTime()) ? new Date(due).toISOString().slice(0, 10) : null) ?? parseDateRu(label);
  const { data: existing } = await supabase.from("pa_docs").select("id, title, expires_on").ilike("title", title).maybeSingle();
  let d = existing;
  if (!d) {
    ({ data: d } = await supabase.from("pa_docs").insert({ title, expires_on: exp }).select("id, title, expires_on").single());
  } else if (exp && exp !== d.expires_on) {
    await supabase.from("pa_docs").update({ expires_on: exp }).eq("id", d.id);
    d.expires_on = exp;
  }
  if (exp) { // за месяц и за неделю до конца срока
    for (const days of [30, 7]) {
      const at = new Date(`${exp}T05:00:00Z`).getTime() - days * 864e5; // 10:00 по Ашхабаду
      if (at > Date.now()) {
        await supabase.from("pa_reminders").insert({ text: `Через ${days === 30 ? "месяц" : "неделю"} кончается срок: ${d.title} (${exp.split("-").reverse().join(".")})`, due_at: new Date(at).toISOString() });
      }
    }
  }
  await supabase.from("pa_state").upsert({ key: "pending_doc", value: JSON.stringify({ id: d.id, at: Date.now() }) });
  return d;
}

export async function pendingDocId(): Promise<number | null> {
  const { data } = await supabase.from("pa_state").select("value").eq("key", "pending_doc").maybeSingle();
  if (!data) return null;
  try {
    const o = JSON.parse(data.value);
    return Date.now() - Number(o.at) <= 10 * 60e3 ? Number(o.id) : null; // ждём сканы 10 минут
  } catch {
    return null;
  }
}

// зашифровать файл и положить в хранилище
export async function storeDocFile(docId: number, bytes: Uint8Array, mime: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await paKey(), bytes));
  const blob = new Uint8Array(12 + enc.length);
  blob.set(iv, 0);
  blob.set(enc, 12);
  const path = `${docId}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.bin`;
  const { error } = await supabase.storage.from("pa-docs").upload(path, blob, { contentType: "application/octet-stream" });
  if (error) throw error;
  await supabase.from("pa_doc_files").insert({ doc_id: docId, path, mime });
}

// прислать сканы документа; удалить из чата через 5 минут
export async function sendDoc(chatId: number, docId: number) {
  const { data: d } = await supabase.from("pa_docs").select("title, expires_on").eq("id", docId).maybeSingle();
  const { data: files } = await supabase.from("pa_doc_files").select("path, mime").eq("doc_id", docId).order("id");
  if (!d) return;
  if (!files?.length) {
    await bot.api.sendMessage(chatId, `🗂 ${d.title}: сканов нет.`);
    return;
  }
  for (const f of files) {
    const { data: blob } = await supabase.storage.from("pa-docs").download(f.path);
    if (!blob) continue;
    const all = new Uint8Array(await blob.arrayBuffer());
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await paKey(), all.slice(12)));
    const ext = f.mime.includes("pdf") ? "pdf" : f.mime.includes("png") ? "png" : "jpg";
    const m = f.mime.startsWith("image/")
      ? await bot.api.sendPhoto(chatId, new InputFile(plain, `scan.${ext}`), { caption: `🗂 ${d.title} · удалю через 5 минут` })
      : await bot.api.sendDocument(chatId, new InputFile(plain, `${d.title}.${ext}`), { caption: `🗂 ${d.title} · удалю через 5 минут` });
    await scheduleDelete(chatId, m.message_id, 5);
  }
}

// отложенное удаление сообщений (обрабатывает cron раз в минуту)
export async function scheduleDelete(chatId: number, messageId: number, minutes: number) {
  await supabase.from("pa_state").upsert({ key: `del:${chatId}:${messageId}`, value: String(Date.now() + minutes * 60e3) });
}

export async function processDeletions() {
  const { data } = await supabase.from("pa_state").select("key, value").like("key", "del:%").limit(50);
  for (const r of data ?? []) {
    if (Number(r.value) > Date.now()) continue;
    const [, chat, msg] = r.key.split(":");
    await bot.api.deleteMessage(Number(chat), Number(msg)).catch(() => {});
    await supabase.from("pa_state").delete().eq("key", r.key);
  }
}

// вечерняя проверка хвостов (cron 21:00): пишет первым, только если есть что-то важное
export async function sendPaEvening() {
  const owner = await paOwnerId();
  if (!owner || !(await getFlag("pa_evening", true))) return;
  const mem = await paMemory("незакрытые обещания долги дела встречи без времени сроки завтра");
  const out = await geminiText(
    `Ты — личный ассистент ${ON.gen}. Вечерняя проверка. По памяти найди хвосты, о которых стоит напомнить прямо сейчас: обещания, срок которых подходит или прошёл; то, что он обещал и, похоже, не сделал; долги без движения; встречи и дела на завтра; встречи без времени; документы, которые понадобятся завтра. Коротко, списком, по делу. Если ничего важного нет — верни ровно NONE.`,
    [{ text: mem.text }],
    { models: PA_MODELS, temperature: 0.2, maxTokens: 1500, maxChars: 3000, timeoutMs: 30_000, deadlineMs: 90_000 },
  );
  if (out && !/^none\b/i.test(out.trim())) await bot.api.sendMessage(owner, `🌙 На вечер:\n\n${out}`);
}

// напоминания (cron раз в минуту)
export async function processReminders() {
  await processDeletions(); // заодно — отложенное удаление сообщений с паролями/сканами
  const owner = await paOwnerId();
  if (!owner) return;
  const { data } = await supabase.from("pa_reminders").select("id, text, due_at, repeat, prep")
    .eq("done", false).lte("due_at", new Date().toISOString()).order("due_at").limit(20);
  for (const r of data ?? []) {
    const next = r.repeat ? nextDue(new Date(r.due_at), r.repeat) : null;
    // сначала двигаем/закрываем, потом шлём — чтобы не прислать дважды
    if (next) await supabase.from("pa_reminders").update({ due_at: next.toISOString() }).eq("id", r.id);
    else await supabase.from("pa_reminders").update({ done: true }).eq("id", r.id);
    try {
      await bot.api.sendMessage(owner, `⏰ ${esc(r.text)}${next ? `\n<i>следующее: ${fmtAsh(next)}</i>` : ""}`, HTML);
      if (r.prep) await background(sendMeetingBrief(owner, r.text)); // перед встречей — всё, что известно по теме
    } catch (e) {
      console.error("reminder send failed", e);
    }
  }
}

// перед встречей: собрать из памяти всё, что касается встречи и людей
export async function sendMeetingBrief(owner: number, topic: string) {
  const mem = await paMemory(topic);
  const out = await geminiText(
    `Ты — личный ассистент ${ON.gen}. Через час у него встреча (тема ниже). По его памяти собери, что важно знать перед ней: о чём договаривались раньше, что обещали он и ему, долги и деньги с этими людьми, открытые вопросы, что взять с собой (включая документы из списка документов, если они понадобятся). Коротко, списком. Если в памяти ничего по теме нет — верни пустую строку.`,
    [{ text: `Встреча: ${topic}\n\n${mem.text}` }],
    { models: PA_MODELS, temperature: 0.2, maxTokens: 1200, maxChars: 2500, timeoutMs: 30_000, deadlineMs: 90_000 },
  );
  if (out && out.trim()) await bot.api.sendMessage(owner, `📋 К встрече:\n\n${out}`);
}

// итоги недели (cron, воскресенье 20:00)
export async function sendPaWeekly() {
  const owner = await paOwnerId();
  if (!owner) return;
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: notes } = await supabase.from("pa_notes").select("kind, text, place, created_at").gte("created_at", since).order("id");
  const { data: rem } = await supabase.from("pa_reminders").select("text, due_at, repeat").eq("done", false)
    .lte("due_at", new Date(Date.now() + 7 * 864e5).toISOString()).order("due_at");
  const { data: people } = await supabase.from("pa_people").select("name").gte("updated_at", since);
  const bal = await moneyBalances();
  const ctx = [
    `Сейчас: ${ashNowText()}`,
    // deno-lint-ignore no-explicit-any
    "Заметки за неделю:\n" + ((notes ?? []).map((n: any) => `[${fmtAsh(n.created_at).slice(0, 10)}${n.place ? `, ${n.place}` : ""}] ${trunc(n.text, 500)}`).join("\n") || "(нет)"),
    // deno-lint-ignore no-explicit-any
    "Люди, с кем было что-то новое: " + ((people ?? []).map((p: any) => p.name).join(", ") || "(никого)"),
    "Деньги:\n" + (bal.join("\n") || "(всё закрыто)"),
    "Работа (активные):\n" + ((await Promise.all((await allWork()).filter((w) => w.status === "active").map((w) => workCard(w)))).join("\n\n") || "(нет)"),
    // deno-lint-ignore no-explicit-any
    "Напоминания на следующую неделю:\n" + ((rem ?? []).map((r: any) => `${fmtAsh(r.due_at)} — ${r.text}`).join("\n") || "(нет)"),
  ].join("\n\n");
  const out = await geminiText(
    `Ты — личный ассистент ${ON.gen}. Составь итоги недели: по каждой активной работе/проекту — что сдвинулось и что висит; с кем виделся и о чём договорился, что обещал и не сделал (если видно), открытые вопросы, деньги и долги, что на следующей неделе. Коротко, по разделам, списками, без воды.`,
    [{ text: ctx }],
    { models: PA_MODELS, temperature: 0.2, maxTokens: 2000, maxChars: 3800, timeoutMs: 40_000, deadlineMs: 120_000 },
  );
  if (out) await bot.api.sendMessage(owner, `🗓 Итоги недели\n\n${out}`);
}

// утренняя сводка (cron)
export async function sendPaSummary() {
  const owner = await paOwnerId();
  if (!owner || !(await getFlag("pa_summary", true))) return;
  const mem = await paMemory("встречи сроки дедлайны договорённости на сегодня и ближайшие дни");
  const out = await geminiText(PA_SUMMARY_SYSTEM, [{ text: mem.text }], {
    models: PA_MODELS, temperature: 0.2, maxTokens: 1500, maxChars: 3500, timeoutMs: 30_000, deadlineMs: 90_000,
  });
  if (out) await bot.api.sendMessage(owner, `☀️ Сводка на ${ashParts().date}\n\n${out}`);
}

// меню команд (кнопка слева от поля ввода) — только в личке владельца
export async function setPaCommands(chatId: number) {
  await bot.api.setMyCommands([
    { command: "pa", description: "Как пользоваться" },
    { command: "work", description: "Работа: проекты, клиенты, поездки" },
    { command: "tasks", description: "Дела" },
    { command: "promises", description: "Обещания" },
    { command: "debts", description: "Деньги и долги" },
    { command: "contacts", description: "Телефонная книжка" },
    { command: "docs", description: "Документы и сканы" },
    { command: "pass", description: "Доступы и пароли" },
    { command: "mem", description: "Выгрузить всю память" },
    { command: "forget", description: "Удаление" },
    { command: "pasum", description: "Утренняя сводка вкл/выкл" },
    { command: "paeve", description: "Вечерняя проверка вкл/выкл" },
  ], { scope: { type: "chat", chat_id: chatId } }).catch((e) => console.error("setMyCommands", e));
}

// регистрация обработчиков — вызывается из index.ts строго по порядку: core → assistant → group
export function registerAssistant() {
  // --- ожидаемый секрет перехватываем раньше всех обработчиков (и мимо журнала/нейросети) ---
  bot.use(async (ctx, next) => {
    // только новые сообщения (правки, например живая геолокация, секретом не считаются)
    if (ctx.chat?.type === "private" && ctx.message && (await isPaOwner(ctx))) {
      // сканы документа: после «сохрани паспорт» или фото с такой подписью — шифруем мимо нейросети
      const m = ctx.message;
      const file = m.photo ? m.photo[m.photo.length - 1] : (m.document ?? null);
      const capLabel = file ? docStartLabel(m.caption ?? "") : "";
      const docId = capLabel ? (await startDoc(capLabel)).id : (file ? await pendingDocId() : null);
      if (file && docId) {
        if (!PA_KEY_B64) {
          await ctx.reply("Ключ шифрования не настроен — не сохраняю.");
          return;
        }
        const bytes = await tgDownload(file.file_id);
        if (!bytes) {
          await ctx.reply("Не смог скачать файл, пришли ещё раз.");
          return;
        }
        await storeDocFile(docId, bytes, m.photo ? "image/jpeg" : (m.document?.mime_type ?? "application/octet-stream"));
        await supabase.from("pa_state").upsert({ key: "pending_doc", value: JSON.stringify({ id: docId, at: Date.now() }) });
        await bot.api.deleteMessage(ctx.chat.id, m.message_id).catch(() => {});
        const { count } = await supabase.from("pa_doc_files").select("*", { count: "exact", head: true }).eq("doc_id", docId);
        await ctx.reply(`🗂 Зашифровал, страниц: ${count ?? 1}. Твоё сообщение удалил. Ещё страницы — кидай, закончить — «готово».`);
        return;
      }
      if (m.text && /^(готово|всё|все|хватит)$/i.test(m.text.trim()) && (await pendingDocId())) {
        await supabase.from("pa_state").delete().eq("key", "pending_doc");
        await ctx.reply("🗂 Документ сохранён. Выдать — /docs");
        return;
      }
      const label = await paGetPending();
      if (label) {
        const t = ctx.message.text ?? "";
        if (/^(отмена|\/cancel)$/i.test(t.trim())) {
          await paSetPending(null);
          await ctx.reply("Отменил.");
          return;
        }
        if (!t) {
          await ctx.reply("Жду секрет текстом. Отмена — «отмена».");
          return;
        }
        if (!PA_KEY_B64) {
          await ctx.reply("Ключ шифрования не настроен — не сохраняю.");
          return;
        }
        const { cipher, iv } = await encryptSecret(t);
        const wk = workMentioned(await allWork(), label)[0]; // «доступ к серверу для Альфы» → работа Альфа
        await supabase.from("pa_secrets").insert({ label, cipher, iv, work_id: wk?.id ?? null });
        await paSetPending(null);
        await bot.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
        await ctx.reply(`🔐 Сохранил: ${label}\nТвоё сообщение удалил. Выдать — /pass`);
        return;
      }
    }
    await next();
  });

  // --- /pass — доступы: список, выдача по номеру/словам, новый, удаление ---
  bot.command("pass", async (ctx) => {
    if (!(await isPaOwner(ctx))) return;
    const arg = (ctx.match ?? "").trim();
    const mNew = arg.match(/^(?:new|add|новый|добавь)\s+([\s\S]+)$/i);
    const mDel = arg.match(/^(?:del|rm|удали)\s+(\d+)$/i);
    if (mNew) {
      await paSetPending(mNew[1].trim());
      await ctx.reply(`🔐 Жду следующим сообщением: ${mNew[1].trim()}\nОтмена — «отмена».`);
      return;
    }
    const { data } = await supabase.from("pa_secrets").select("id, label, cipher, iv").order("id");
    const all = data ?? [];
    if (mDel) {
      const s = all[Number(mDel[1]) - 1];
      if (!s) {
        await ctx.reply("Нет такого номера.");
        return;
      }
      await supabase.from("pa_secrets").delete().eq("id", s.id);
      await ctx.reply(`🗑 Удалил: ${s.label}`);
      return;
    }
    if (!arg) {
      await ctx.reply(all.length
        ? "🔐 Доступы:\n" + all.map((s, i) => `${i + 1}. ${s.label}`).join("\n") + "\n\n/pass номер — выдать · /pass new название — добавить · /pass del номер — удалить"
        : "Доступов пока нет. Добавить: «сохрани доступ к …» или /pass new название");
      return;
    }
    const found = await findSecrets(arg);
    if (found.length === 1) await sendSecret(ctx.chat.id, found[0]);
    else if (found.length > 1) await ctx.reply("Подходит несколько:\n" + found.map((s) => `• ${s.label}`).join("\n"));
    else await ctx.reply("Не нашёл. Список — /pass");
  });

  // --- /mem — выгрузка всей памяти файлом (без паролей: только их названия) ---
  bot.command("mem", async (ctx) => {
    if (!(await isPaOwner(ctx))) return;
    const { data: notes } = await supabase.from("pa_notes").select("id, kind, text, source, people, created_at").order("id");
    const { data: people } = await supabase.from("pa_people").select("name, facts").order("name");
    const { data: rem } = await supabase.from("pa_reminders").select("id, text, due_at, repeat").eq("done", false).order("due_at");
    const { data: secrets } = await supabase.from("pa_secrets").select("label").order("id");
    const out = [
      `Память ассистента · выгружено ${ashNowText()}`,
      `\n=== НАПОМИНАНИЯ (${rem?.length ?? 0}) ===`,
      // deno-lint-ignore no-explicit-any
      ...(rem ?? []).map((r: any) => `#${r.id} ${fmtAsh(r.due_at)} — ${r.text}${r.repeat ? ` [${r.repeat}]` : ""}`),
      `\n=== ЛЮДИ (${people?.length ?? 0}) ===`,
      // deno-lint-ignore no-explicit-any
      ...(people ?? []).map((p: any) => `\n${p.name}\n${p.facts}`),
      `\n=== ЗАМЕТКИ (${notes?.length ?? 0}) ===`,
      // deno-lint-ignore no-explicit-any
      ...(notes ?? []).map((n: any) => `\n#${n.id} [${n.kind}] ${fmtAsh(n.created_at)}${n.source ? ` · ${n.source}` : ""}${n.people?.length ? ` · ${n.people.join(", ")}` : ""}\n${n.text}`),
      `\n=== МЕСТА ===`,
      ...(await allPlaces()).map((p) => `${p.name}${p.aliases?.length ? ` [${p.aliases.join(", ")}]` : ""}${p.address ? ` — ${p.address}` : ""}${p.lat != null ? ` (${p.lat.toFixed(5)}, ${p.lon.toFixed(5)})` : ""}${p.facts ? `\n${p.facts}` : ""}`),
      `\n=== РАБОТА ===`,
      ...(await Promise.all((await allWork()).map((w) => workCard(w)))),
      `\n=== ОБЕЩАНИЯ ===`,
      ...((await supabase.from("pa_promises").select("id, who, person, text, due_at, done").order("id")).data ?? []).map((p) => `#${p.id} ${p.done ? "[выполнено] " : ""}${p.who === "me" ? "я обещал" : "мне обещал"}${p.person ? ` ${p.person}` : ""}: ${p.text}${p.due_at ? ` (до ${fmtAsh(p.due_at)})` : ""}`),
      `\n=== ДЕЛА ===`,
      ...((await supabase.from("pa_tasks").select("id, text, done").order("id")).data ?? []).map((t) => `#${t.id} ${t.done ? "[сделано] " : ""}${t.text}`),
      `\n=== ДОКУМЕНТЫ (сканы — /docs) ===`,
      ...((await supabase.from("pa_docs").select("title, expires_on").order("id")).data ?? []).map((d) => `${d.title}${d.expires_on ? ` — до ${d.expires_on}` : ""}`),
      `\n=== ДЕНЬГИ ===`,
      ...(await moneyBalances()),
      `\n=== ДОСТУПЫ (только названия, значения — /pass) ===`,
      // deno-lint-ignore no-explicit-any
      ...(secrets ?? []).map((s: any, i: number) => `${i + 1}. ${s.label}`),
    ].join("\n");
    await ctx.replyWithDocument(new InputFile(new TextEncoder().encode(out), `pamyat_${ashParts().date}.txt`));
  });

  // --- /forget — удаление: /forget note N | person Имя | remind N | all ---
  bot.command("forget", async (ctx) => {
    if (!(await isPaOwner(ctx))) return;
    const arg = (ctx.match ?? "").trim();
    let m;
    if ((m = arg.match(/^(?:note|заметк\S*)\s+(\d+)$/i))) {
      await supabase.from("pa_notes").delete().eq("id", Number(m[1]));
      await ctx.reply(`🗑 Заметка #${m[1]} удалена.`);
    } else if ((m = arg.match(/^(?:person|человек\S*)\s+(.+)$/i))) {
      await supabase.from("pa_people").delete().ilike("name", m[1].trim());
      await ctx.reply(`🗑 ${m[1].trim()} удалён.`);
    } else if ((m = arg.match(/^(?:remind|напомин\S*)\s+(\d+)$/i))) {
      await supabase.from("pa_reminders").update({ done: true }).eq("id", Number(m[1]));
      await ctx.reply(`🗑 Напоминание #${m[1]} отменено.`);
    } else if (/^all confirm$/i.test(arg)) {
      await supabase.from("pa_notes").delete().gt("id", 0);
      await supabase.from("pa_people").delete().gt("id", 0);
      await supabase.from("pa_reminders").delete().gt("id", 0);
      await supabase.from("pa_history").delete().gt("id", 0);
      await supabase.from("pa_money").delete().gt("id", 0);
      await supabase.from("pa_places").delete().gt("id", 0);
      await supabase.from("pa_promises").delete().gt("id", 0);
      await supabase.from("pa_tasks").delete().gt("id", 0);
      await supabase.from("pa_work").delete().gt("id", 0);
      await ctx.reply("🗑 Стёр заметки, людей, места, напоминания, деньги и историю. Доступы не трогал (/pass del).");
    } else if (/^all$/i.test(arg)) {
      await ctx.reply("Точно стереть ВСЮ память (кроме доступов)? Напиши: /forget all confirm");
    } else {
      await ctx.reply("Удаление:\n/forget note N — заметку\n/forget person Имя — человека\n/forget remind N — напоминание\n/forget all — всё (кроме доступов)\nНомера видны в /mem. Или просто скажи: «забудь про …».");
    }
  });

  // --- /docs — документы: список, выдача сканов, удаление ---
  bot.command("docs", async (ctx) => {
    if (!(await isPaOwner(ctx))) return;
    const arg = (ctx.match ?? "").trim();
    const { data } = await supabase.from("pa_docs").select("id, title, expires_on").order("id");
    const all = data ?? [];
    const mDel = arg.match(/^(?:del|удали)\s+(\d+)$/i);
    if (mDel) {
      const d = all[Number(mDel[1]) - 1];
      if (!d) return void (await ctx.reply("Нет такого номера."));
      const { data: files } = await supabase.from("pa_doc_files").select("path").eq("doc_id", d.id);
      if (files?.length) await supabase.storage.from("pa-docs").remove(files.map((f) => f.path));
      await supabase.from("pa_docs").delete().eq("id", d.id);
      return void (await ctx.reply(`🗑 Удалил: ${d.title}`));
    }
    if (/^\d+$/.test(arg)) {
      const d = all[Number(arg) - 1];
      if (!d) return void (await ctx.reply("Нет такого номера."));
      return void (await sendDoc(ctx.chat.id, d.id));
    }
    if (arg) {
      const hit = all.filter((d) => d.title.toLowerCase().includes(arg.toLowerCase().slice(0, Math.max(3, arg.length - 2))));
      if (hit.length === 1) return void (await sendDoc(ctx.chat.id, hit[0].id));
    }
    await ctx.reply(all.length
      ? "🗂 Документы:\n" + all.map((d, i) => `${i + 1}. ${d.title}${d.expires_on ? ` — до ${d.expires_on.split("-").reverse().join(".")}` : ""}`).join("\n") + "\n\n/docs номер — прислать сканы · /docs del номер — удалить\nДобавить: «сохрани паспорт» и кинь фото"
      : "Документов пока нет. Скажи «сохрани паспорт» и кинь фото.");
  });

  // --- /tasks, /promises ---
  bot.command("tasks", async (ctx) => {
    if (!(await isPaOwner(ctx))) return;
    const { data } = await supabase.from("pa_tasks").select("id, text").eq("done", false).order("id");
    await ctx.reply(data?.length ? "☑️ Дела:\n" + data.map((t) => `#${t.id} ${t.text}`).join("\n") + "\n\nСделал — скажи «сделал #N» или своими словами." : "Открытых дел нет.");
  });

  bot.command("promises", async (ctx) => {
    if (!(await isPaOwner(ctx))) return;
    const { data } = await supabase.from("pa_promises").select("id, who, person, text, due_at").eq("done", false).order("id");
    const fmt = (p: { id: number; person: string; text: string; due_at: string | null }) => `#${p.id}${p.person ? ` ${p.person}:` : ""} ${p.text}${p.due_at ? ` (до ${fmtAsh(p.due_at)})` : ""}`;
    const mine = (data ?? []).filter((p) => p.who === "me"), theirs = (data ?? []).filter((p) => p.who !== "me");
    await ctx.reply((mine.length || theirs.length)
      ? `🤝 Ты обещал:\n${mine.map(fmt).join("\n") || "—"}\n\n🤝 Тебе обещали:\n${theirs.map(fmt).join("\n") || "—"}`
      : "Открытых обещаний нет.");
  });

  bot.command("paeve", async (ctx) => {
    if (!(await isPaOwner(ctx))) return;
    await ownerToggle(ctx, "paeve", "pa_evening", "Вечерняя проверка хвостов (21:00)", true);
  });

  // --- /contacts — телефонная книжка: поиск, количество ---
  bot.command("contacts", async (ctx) => {
    if (!(await isPaOwner(ctx))) return;
    const q = (ctx.match ?? "").trim();
    if (!q) {
      const { count } = await supabase.from("pa_contacts").select("*", { count: "exact", head: true });
      return void (await ctx.reply(`📇 В книжке: ${count ?? 0}.\nИскать: /contacts имя\nДобавить: кинь файл .vcf (экспорт контактов) или контакт через скрепку.\nСтереть книжку: /contacts clear`));
    }
    if (/^clear$/i.test(q)) {
      await supabase.from("pa_contacts").delete().gt("id", 0);
      return void (await ctx.reply("🗑 Книжку стёр."));
    }
    const { data } = await supabase.from("pa_contacts").select("name, phones, org").ilike("name", `%${q.replace(/[%,]/g, "")}%`).limit(20);
    await ctx.reply(data?.length ? data.map((c) => `${c.name}${c.org ? ` (${c.org})` : ""}: ${c.phones.join(", ")}`).join("\n") : "Не нашёл.");
  });

  // --- /work — работа: список или карточка ---
  bot.command("work", async (ctx) => {
    if (!(await isPaOwner(ctx))) return;
    const q = (ctx.match ?? "").trim();
    const list = await allWork();
    if (q) {
      const w = workByName(list, q);
      return void (await ctx.reply(w ? await workCard(w) : "Не нашёл. Список — /work"));
    }
    if (!list.length) return void (await ctx.reply("Пока пусто. Расскажи о проекте, клиенте или работе — запишу."));
    const order = ["active", "idea", "paused", "closed"];
    const out = order.map((st) => {
      const ws = list.filter((w) => w.status === st);
      return ws.length ? `${WORK_STATUS[st]}:\n` + ws.map((w) => `• ${w.name} (${WORK_KIND[w.kind] ?? w.kind})`).join("\n") : "";
    }).filter(Boolean).join("\n\n");
    await ctx.reply(`💼 Работа\n\n${out}\n\nПодробно — /work название`);
  });

  // --- /debts — деньги и долги ---
  bot.command("debts", async (ctx) => {
    if (!(await isPaOwner(ctx))) return;
    const bal = await moneyBalances();
    await ctx.reply(bal.length ? "💰 Деньги:\n" + bal.join("\n") : "Все долги закрыты.");
  });

  // --- /pa — справка ассистента ---
  bot.command("pa", async (ctx) => {
    if (!(await isPaOwner(ctx))) return;
    // постоянная кнопка: одно нажатие — отправить геолокацию (следующий час сообщения считаются сказанными там)
    const kb = await paKeyboard();
    await setPaCommands(ctx.chat.id);
    await ctx.reply(`<b>Личный ассистент</b>
  Пиши как обычно — текстом, голосом, скриншотом. Сам разложу по полочкам.

  <b>Запомнить</b>
  запомни… · пересланное · скриншоты · голосовые

  <b>Напомнить</b>
  напомни 12.03 про… · каждый месяц 5-го…
  Встречи — за час, со сводкой по теме

  <b>Спросить</b>
  что я знаю про Ивана? · что по Альфе?

  <b>Деньги и обещания</b>
  Иван занял 500 · я обещал Пете…

  <b>Секретное</b> — мимо нейросети, шифрую
  сохрани доступ к… · сохрани паспорт + фото

  <b>Место</b> — кнопка «📍 Я здесь» внизу

  Все разделы — в меню команд слева от поля ввода.`, { ...HTML, reply_markup: kb });
  });

  bot.command("pasum", async (ctx) => {
    if (!(await isPaOwner(ctx))) return;
    await ownerToggle(ctx, "pasum", "pa_summary", "Утренняя сводка ассистента", true);
  });

  // живая геолокация приходит правками сообщения
  bot.on("edited_message:location", async (ctx) => {
    if (ctx.chat.type !== "private" || !(await isPaOwner(ctx))) return;
    const l = ctx.editedMessage.location;
    const e = ctx.editedMessage;
    if (!l.live_period) { // трансляцию остановили — вернуть кнопку
      await supabase.from("pa_state").delete().eq("key", "live");
      await bot.api.sendMessage(ctx.chat.id, "📡 Трансляция закончилась.", { reply_markup: await paKeyboard() });
      return;
    }
    await background(paOnLocation(ctx.chat.id, l.latitude, l.longitude, true, { date: e.date, period: l.live_period }));
  });
}
