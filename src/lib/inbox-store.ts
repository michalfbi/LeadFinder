import replyRules from "../../reply-rules.json";

/**
 * Skrzynka odpowiedzi po stronie interfejsu. Na Macu rozmawia z silnikiem
 * (electron/inbox.cjs); w przeglądarce działa na danych próbnych w localStorage
 * i nigdy niczego nie wysyła.
 */

export type ReplyCategory = keyof typeof replyRules.categories;
export type InboxStatus =
  "pending" | "sending" | "sent" | "blocked" | "ignored" | "dismissed";
export type InboxMarket = "US" | "PL";

export type InboxMessage = {
  id: string;
  leadId: string;
  channel: "sms" | "email";
  address: string | null;
  body: string;
  status: InboxStatus;
  category: ReplyCategory;
  at: number;
  leadName: string | null;
  market: InboxMarket;
  confidence: number;
  source: "rules" | "ai";
  draft: string;
  needsEdit: boolean;
  draftFromAi?: boolean;
  aiError?: string | null;
  sendError?: string | null;
  outbound?: string | null;
  sentText?: string;
};

export type ReplyData = (typeof replyRules.defaults)["US"];
export type InboxSettings = {
  ai: {
    enabled: boolean;
    model: string;
    dailyLimit: number;
    keyConfigured: boolean;
    usedToday: number;
  };
  data: Record<InboxMarket, ReplyData>;
};
export type InboxSettingsPatch = {
  ai?: {
    enabled?: boolean;
    model?: string;
    dailyLimit?: number;
    key?: string;
    clearKey?: boolean;
  };
  data?: Partial<Record<InboxMarket, Partial<ReplyData>>>;
};
export type InboxCounts = Record<
  "pending" | "blocked" | "sent" | "ignored" | "dismissed",
  number
>;

type InboxBridge = {
  list: (filter?: { status?: InboxStatus }) => Promise<InboxMessage[]>;
  counts: () => Promise<InboxCounts>;
  approve: (id: string, body: string) => Promise<InboxMessage>;
  dismiss: (id: string) => Promise<InboxMessage>;
  block: (id: string) => Promise<InboxMessage>;
  settings: () => Promise<InboxSettings>;
  configure: (value: InboxSettingsPatch) => Promise<InboxSettings>;
  testAi: () => Promise<{ ok: boolean; output: string }>;
  onChanged: (cb: () => void) => () => void;
};

export const CATEGORY_LABEL = Object.fromEntries(
  Object.entries(replyRules.categories).map(([id, c]) => [id, c.label]),
) as Record<ReplyCategory, string>;

export const REPLY_FIELDS: Array<{
  key: keyof ReplyData;
  label: string;
  hint: string;
}> = [
  {
    key: "price",
    label: "Cena",
    hint: "Wstawiana w zdaniu „A complete website for … is …”.",
  },
  {
    key: "includes",
    label: "Co jest w cenie",
    hint: "Po słowach „That covers …”.",
  },
  {
    key: "timeline",
    label: "Termin realizacji",
    hint: "Po słowach „Turnaround is …”.",
  },
  {
    key: "mockupTime",
    label: "Czas przygotowania darmowego projektu",
    hint: "np. 2 business days",
  },
  {
    key: "calendarUrl",
    label: "Link do kalendarza (opcjonalnie)",
    hint: "Puste = bez zdania o rozmowie.",
  },
  {
    key: "paymentNote",
    label: "Zdanie o płatności",
    hint: "Jedno pełne zdanie, np. o fakturze przez Useme.",
  },
  { key: "signature", label: "Podpis", hint: "Twoje imię pod odpowiedzią." },
];

export function inboxBridge(): InboxBridge | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { leadfinder?: { inbox?: InboxBridge } }).leadfinder
      ?.inbox ?? null
  );
}

/* ------------------------- podgląd w przeglądarce ------------------------- */

const MOCK_KEY = "leadfinder.inbox-preview";
const SETTINGS_KEY = "leadfinder.inbox-preview-settings";
const EVENT = "leadfinder:inbox-change";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* podgląd działa wtedy do odświeżenia strony */
  }
  window.dispatchEvent(new Event(EVENT));
}

function mockSettings(): InboxSettings {
  const stored = load<Partial<InboxSettings>>(SETTINGS_KEY, {});
  return {
    ai: {
      enabled: false,
      model: replyRules.ai.defaultModel,
      dailyLimit: replyRules.ai.dailyLimit,
      keyConfigured: false,
      usedToday: 0,
      ...stored.ai,
    },
    data: {
      US: { ...replyRules.defaults.US, ...stored.data?.US },
      PL: { ...replyRules.defaults.PL, ...stored.data?.PL },
    },
  };
}

/** Szkic z szablonu: ta sama logika co buildDraft w silniku (pilnuje tego test), używana tylko w podglądzie. */
export function previewDraft(
  category: ReplyCategory,
  market: InboxMarket,
  data: Partial<ReplyData>,
  name: string,
): string {
  const template =
    (replyRules.templates[market] as Record<string, string>)[category] ?? "";
  if (!template) return "";
  const filled = Object.fromEntries(
    Object.entries(data).filter(([, v]) => String(v ?? "").trim() !== ""),
  );
  const merged: Record<string, string> = {
    ...replyRules.defaults[market],
    ...filled,
  };
  const calendarUrl = (merged["calendarUrl"] ?? "").trim();
  const calendarLine = calendarUrl
    ? replyRules.calendarLine[market].replace("{calendarUrl}", calendarUrl)
    : "";
  const vars: Record<string, string> = { ...merged, name, calendarLine };
  let text = template.replace(
    /\{(\w+)\}/g,
    (_, key: string) => vars[key] ?? "",
  );
  text = text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?])/g, "$1")
    .trim();
  const signature = (merged["signature"] ?? "").trim();
  if (signature)
    text += market === "US" ? `\n\nBest,\n${signature}` : `\n\n${signature}`;
  return text;
}

function seed(): InboxMessage[] {
  const data = mockSettings().data;
  const now = Date.now();
  const make = (
    i: number,
    leadName: string,
    body: string,
    category: ReplyCategory,
    status: InboxStatus,
    extra: Partial<InboxMessage> = {},
  ): InboxMessage => {
    const draft =
      status === "pending"
        ? previewDraft(category, "US", data.US, leadName)
        : "";
    return {
      id: `demo-${i}`,
      leadId: `demo-lead-${i}`,
      channel: "email",
      address: `info@${leadName.toLowerCase().replace(/[^a-z]/g, "")}.com`,
      body,
      status,
      category,
      at: now - i * 3_600_000,
      leadName,
      market: "US",
      confidence:
        (replyRules.confidence as Record<string, number>)[category] ?? 0.5,
      source: "rules",
      draft,
      needsEdit: status === "pending" && !draft,
      outbound:
        'Hi,\n\nI was looking at your website and noticed that browsers mark it as "Not Secure" because there is no SSL certificate...',
      ...extra,
    };
  };
  return [
    make(
      1,
      "Brooks Roofing",
      "Sure, send the mockup over. What would it cost?",
      "cena",
      "pending",
    ),
    make(
      2,
      "Hughes & Sons Plumbing",
      "Sounds good. Call me at 918-555-0123.",
      "zainteresowany",
      "pending",
    ),
    make(
      3,
      "Parker Fencing",
      "Can you keep my current domain?",
      "pytanie",
      "pending",
    ),
    make(
      4,
      "Summit Tree Service",
      "Not right now, we're in the middle of busy season.",
      "nie_teraz",
      "pending",
    ),
    make(
      5,
      "Blue Ridge Concrete",
      "Not interested, please remove me.",
      "odmowa",
      "blocked",
    ),
    make(
      6,
      "Liberty Septic",
      "How did you get my email?",
      "nieufnosc",
      "blocked",
    ),
    make(
      7,
      "Reed Landscaping",
      "I am out of the office until Monday.",
      "autoodpowiedz",
      "ignored",
    ),
  ];
}

function mockList(): InboxMessage[] {
  const stored = load<InboxMessage[] | null>(MOCK_KEY, null);
  if (stored) return stored;
  const rows = seed();
  save(MOCK_KEY, rows);
  return rows;
}
function mockUpdate(id: string, patch: Partial<InboxMessage>): InboxMessage {
  const rows = mockList().map((m) => (m.id === id ? { ...m, ...patch } : m));
  save(MOCK_KEY, rows);
  return rows.find((m) => m.id === id)!;
}

/* ------------------------------- wspólne API ------------------------------- */

export async function listInbox(): Promise<InboxMessage[]> {
  return (await inboxBridge()?.list()) ?? mockList();
}
export async function approveReply(
  id: string,
  body: string,
): Promise<InboxMessage> {
  const bridge = inboxBridge();
  if (bridge) return bridge.approve(id, body);
  return mockUpdate(id, { status: "sent", sentText: body });
}
export async function dismissReply(id: string): Promise<InboxMessage> {
  const bridge = inboxBridge();
  if (bridge) return bridge.dismiss(id);
  return mockUpdate(id, { status: "dismissed" });
}
export async function blockReply(id: string): Promise<InboxMessage> {
  const bridge = inboxBridge();
  if (bridge) return bridge.block(id);
  return mockUpdate(id, { status: "blocked" });
}
export async function readInboxSettings(): Promise<InboxSettings> {
  return (await inboxBridge()?.settings()) ?? mockSettings();
}
export async function saveInboxSettings(
  patch: InboxSettingsPatch,
): Promise<InboxSettings> {
  const bridge = inboxBridge();
  if (bridge) return bridge.configure(patch);
  const current = mockSettings();
  const next: InboxSettings = {
    ai: {
      ...current.ai,
      ...(patch.ai?.enabled !== undefined ? { enabled: patch.ai.enabled } : {}),
      ...(patch.ai?.model !== undefined ? { model: patch.ai.model } : {}),
      ...(patch.ai?.dailyLimit !== undefined
        ? { dailyLimit: patch.ai.dailyLimit }
        : {}),
    },
    data: {
      US: { ...current.data.US, ...patch.data?.US },
      PL: { ...current.data.PL, ...patch.data?.PL },
    },
  };
  save(SETTINGS_KEY, next);
  return next;
}
export function resetInboxPreview(): void {
  try {
    window.localStorage.removeItem(MOCK_KEY);
  } catch {
    /* brak dostępu do magazynu */
  }
  window.dispatchEvent(new Event(EVENT));
}
export function onInboxChange(cb: () => void): () => void {
  const off = inboxBridge()?.onChanged(cb);
  window.addEventListener(EVENT, cb);
  return () => {
    off?.();
    window.removeEventListener(EVENT, cb);
  };
}
