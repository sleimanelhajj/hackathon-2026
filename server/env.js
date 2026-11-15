// Startup configuration check. Names what is missing and what stops working; never prints a value.

const REQUIRED = [
  ["MONGODB_URI", "the app's database"],
  ["TOKEN_SECRET", "encrypting sign-in tokens and email bodies"],
];

/** Optional groups: [variables, what is off without them]. A variable may list other accepted spellings after "|". */
const OPTIONAL = [
  [["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"], "Connecting Gmail"],
  [["GEMINI_API_KEY"], "AI email sorting, summaries and the assistant"],
  [["POSTGRES_URL"], "The Sales page and the assistant's sales answers"],
  [["TELEGRAM_API_ID|API_ID|api_id", "TELEGRAM_API_HASH|API_HASH|api_hash"], "Connecting Telegram"],
];

const set = (v) => typeof v === "string" && v.trim() !== "";
const anySet = (env, spec) => spec.split("|").some((n) => set(env[n]));

/** { missing, warnings }: missing stops the server in production; warnings only turn a feature off. */
export function checkEnv(env = process.env, { production = env.NODE_ENV === "production" } = {}) {
  const missing = REQUIRED.filter(([name]) => !set(env[name])).map(([name, why]) => ({ name, why }));
  if (production && (!set(env.APP_URL) || /localhost|127\.0\.0\.1/.test(env.APP_URL))) {
    missing.push({ name: "APP_URL", why: "where Google sends people back after sign-in (the public address of this app)" });
  }
  const warnings = [];
  for (const [names, feature] of OPTIONAL) {
    const absent = names.filter((n) => !anySet(env, n)).map((n) => n.split("|")[0]);
    if (absent.length) warnings.push({ name: absent[0], names: absent, why: `${feature} is off` });
  }
  return { missing, warnings };
}

/** Logs the check; returns false when the server shouldn't start. */
export function reportEnv(env = process.env) {
  const production = env.NODE_ENV === "production";
  const { missing, warnings } = checkEnv(env, { production });
  for (const w of warnings) console.warn(`Config: ${w.why} (set ${w.names.join(", ")}).`);
  for (const m of missing) console.error(`Config: ${m.name} is missing. It's needed for ${m.why}.`);
  return !(production && missing.length);
}
