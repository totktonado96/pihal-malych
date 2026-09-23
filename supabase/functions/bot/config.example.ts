// Образец личных настроек. Скопируй в config.ts и впиши свои ники (без @, в нижнем регистре).
export const SUPER_OWNER = "your_username"; // главный админ
export const OWNER_SURNAME = "Иванов"; // фамилия создателя — для отказов «не оскорбляю»
export const DELETERS_LIST = ["your_username", "friend_one"]; // могут /del и /edit
export const DELETERS_TEXT = "@your_username и @friend_one"; // как показывать в чате
export const LENYA = "lenya_username"; // герой шуток
export const LINK_SUSPECTS_LIST = ["link_spammer"]; // кому нельзя кидать ссылки
export const LINK_SUSPECT_TEXT = "@link_spammer";
export const PREDICT_EXCLUDE_LIST = ["someone"]; // не участвуют в предсказаниях

// Имена в текстах бота (со всеми падежами). Герой шуток:
export const LN = { nom: "Вася", gen: "Васи", dat: "Васе", acc: "Васю", ins: "Васей", voc: "Вась" };
// Создатель:
export const ON = { nom: "Саша", gen: "Саши", dat: "Саше", acc: "Сашу", ins: "Сашей" };
export const OWNER_STEM = "саш"; // основа имени для распознавания в любом падеже
export const OWNER_LATIN = "sasha"; // имя латиницей
