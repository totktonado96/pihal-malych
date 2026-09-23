// Пихал Малыч: точка входа. Порядок регистрации важен (журнал ответов, мьют, перехват секретов → команды → сообщения).
import { registerCore } from "./core.ts";
import { registerAssistant } from "./assistant.ts";
import { registerGroup } from "./group.ts";

registerCore();
registerAssistant();
registerGroup(); // внутри — Deno.serve
