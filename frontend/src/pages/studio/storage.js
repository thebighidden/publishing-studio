/** Per-browser conveniences (last project, last settings). Never required: every read can fail. */
export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the studio works without it */
  }
}

const PROMPT_HISTORY = "studio-prompt-history";

/** Recent prompts, newest first, without repeats. */
export function promptHistory() {
  const list = loadJSON(PROMPT_HISTORY, []);
  return Array.isArray(list) ? list : [];
}

export function rememberPrompt(prompt) {
  const text = prompt.trim();
  if (!text) return;
  saveJSON(PROMPT_HISTORY, [text, ...promptHistory().filter((p) => p !== text)].slice(0, 40));
}
