"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

type Attachment = { name: string; mime: string; data: string };
type Msg = { role: "user" | "assistant"; content: string; attachments?: Attachment[] };
type Session = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: Msg[];
};
type Mode = "gentle" | "neutral" | "direct";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function newId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function leanMessages(messages: Msg[]): Msg[] {
  return messages.map((m) => ({
    ...m,
    attachments: m.attachments?.map((a) => ({ name: a.name, mime: a.mime, data: "" })),
  }));
}

function groupSessions(sessions: Session[]) {
  const now = Date.now();
  const day = 86400000;
  const groups: { label: string; items: Session[] }[] = [
    { label: "今日", items: [] },
    { label: "過去7日間", items: [] },
    { label: "それ以前", items: [] },
  ];
  for (const s of sessions) {
    const diff = now - new Date(s.updated_at).getTime();
    if (diff < day) groups[0].items.push(s);
    else if (diff < day * 7) groups[1].items.push(s);
    else groups[2].items.push(s);
  }
  return groups.filter((g) => g.items.length > 0);
}

const MODE_INFO: Record<Mode, { label: string; dot: string; desc: string }> = {
  gentle: { label: "甘口", dot: "var(--rose)", desc: "やさしく包んでほしいとき" },
  neutral: { label: "中立", dot: "var(--blue)", desc: "いつもの距離感で" },
  direct: { label: "辛口", dot: "var(--accent)", desc: "率直に映してほしいとき" },
};

export default function Page() {
  const supabase = getSupabase();

  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingHeader, setEditingHeader] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachErr, setAttachErr] = useState("");

  const [mode, setMode] = useState<Mode>("neutral");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  const [recording, setRecording] = useState(false);
  const speechSupportedRef = useRef(false);
  const recognitionRef = useRef<any>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const MAX_BYTES = 8 * 1024 * 1024;
  const ALLOWED = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/plain",
    "text/csv",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ];

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(r.error);
      r.onload = () => {
        const s = String(r.result || "");
        const comma = s.indexOf(",");
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      r.readAsDataURL(file);
    });

  const onPickFiles = async (files: FileList | null) => {
    setAttachErr("");
    if (!files || files.length === 0) return;
    const nextList: Attachment[] = [...attachments];
    let totalBytes = nextList.reduce((n, a) => n + (a.data.length * 3) / 4, 0);
    for (const f of Array.from(files)) {
      if (!ALLOWED.includes(f.type)) {
        setAttachErr(`${f.name} は対応していない形式です`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        setAttachErr(`${f.name} はサイズが大きすぎます（8MBまで）`);
        continue;
      }
      totalBytes += f.size;
      if (totalBytes > MAX_BYTES) {
        setAttachErr("合計サイズが8MBを超えました");
        break;
      }
      const data = await fileToBase64(f);
      nextList.push({ name: f.name, mime: f.type, data });
    }
    setAttachments(nextList);
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeAttachment = (idx: number) => {
    setAttachments((a) => a.filter((_, i) => i !== idx));
  };

  // Supabase auth 監視
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  // ログイン後にセッション一覧を取得
  useEffect(() => {
    if (!user) {
      setSessions([]);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .order("updated_at", { ascending: false });
      if (!error && data) setSessions(data as Session[]);
    })();
  }, [user, supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // 甘口/辛口モードの記憶
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("tapestry-coach-mode") : null;
    if (saved === "gentle" || saved === "neutral" || saved === "direct") setMode(saved);
  }, []);
  const chooseMode = (m: Mode) => {
    setMode(m);
    localStorage.setItem("tapestry-coach-mode", m);
    setModeMenuOpen(false);
  };

  // 音声入力対応チェック
  useEffect(() => {
    speechSupportedRef.current =
      typeof window !== "undefined" &&
      (("SpeechRecognition" in window) || ("webkitSpeechRecognition" in window));
  }, []);

  // ダークモードの記憶（未設定ならOSの設定に従う）
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("tapestry-coach-theme") : null;
    if (saved === "light" || saved === "dark") setTheme(saved);
    if (typeof window !== "undefined") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      setSystemPrefersDark(mq.matches);
      const onChange = () => setSystemPrefersDark(mq.matches);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
  }, []);
  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
  }, [theme]);
  const resolvedTheme: "light" | "dark" = theme || (systemPrefersDark ? "dark" : "light");
  const toggleTheme = () => {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("tapestry-coach-theme", next);
  };

  const toggleRecording = () => {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript;
      }
      if (text) setInput((prev) => (prev ? prev + text : text));
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setRecording(true);
  };

  // 入力欄：文字量に合わせて高さを自動で伸ばす
  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 260) + "px";
  };
  useEffect(() => {
    autoGrow();
  }, [input]);

  if (authLoading) {
    return (
      <div className="gate">
        <div className="gate-card">
          <div className="logo-t">T</div>
        </div>
      </div>
    );
  }

  // ── ログイン画面（マジックリンク） ──
  if (!user) {
    const submit = async () => {
      const v = email.trim();
      if (!v) return;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        setEmailErr("メールアドレスをご確認ください");
        return;
      }
      setSendingEmail(true);
      setEmailErr("");
      const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
      const { error } = await supabase.auth.signInWithOtp({
        email: v,
        options: { emailRedirectTo: redirectTo },
      });
      setSendingEmail(false);
      if (error) {
        setEmailErr("メール送信に失敗しました。少し時間をおいて再度お試しください。");
        return;
      }
      setEmailSent(true);
    };
    return (
      <div className="gate">
        <div className="gate-card">
          <div className="logo-t">T</div>
          <div className="eyebrow">Tapestry Circle専用</div>
          <div className="title-jp">THE THREAD</div>
          <div className="subtitle">
            呼吸を整えながら、
            <br />
            自己と再びつながるAIコーチ
          </div>
          {emailSent ? (
            <div style={{ color: "var(--sub)", fontSize: 13, lineHeight: 2 }}>
              <strong style={{ color: "var(--accent)" }}>{email}</strong>
              <br />
              宛にひらくためのリンクをお送りしました。
              <br />
              <br />
              メール内のリンクをクリックすると、
              <br />
              この場にもどってひらきます。
            </div>
          ) : (
            <>
              <input
                type="email"
                value={email}
                placeholder="メールアドレス"
                autoComplete="email"
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailErr("");
                }}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                autoFocus
              />
              <div className="gate-error">{emailErr}</div>
              <button onClick={submit} disabled={sendingEmail}>
                {sendingEmail ? "送信中…" : "ひらく"}
              </button>
              <div
                style={{
                  marginTop: 18,
                  fontSize: 11,
                  color: "var(--sub)",
                  letterSpacing: "0.02em",
                  lineHeight: 1.9,
                  wordBreak: "keep-all",
                }}
              >
                初回だけメール認証。以後はこの端末なら
                <br />
                開きっぱなしで使えます。対話は1年間保管されます。
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const persistSession = async (sessionId: string, msgs: Msg[], title?: string) => {
    if (!user) return;
    const lean = leanMessages(msgs);
    const existing = sessions.find((s) => s.id === sessionId);
    if (existing) {
      const patch: any = { messages: lean, updated_at: new Date().toISOString() };
      if (title) patch.title = title;
      const { error } = await supabase.from("sessions").update(patch).eq("id", sessionId);
      if (!error) {
        setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, ...patch, messages: lean } : s)));
      }
    } else {
      const row = { id: sessionId, user_id: user.id, title: title ?? "（タイトル未設定）", messages: lean };
      const { data, error } = await supabase.from("sessions").insert(row).select().single();
      if (!error && data) setSessions((prev) => [data as Session, ...prev]);
    }
  };

  const renameSession = async (id: string, title: string) => {
    const t = title.trim().slice(0, 40);
    if (!t) return;
    const { error } = await supabase.from("sessions").update({ title: t }).eq("id", id);
    if (!error) {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: t } : s)));
    }
  };

  const maybeGenerateTitle = async (sessionId: string, msgs: Msg[]) => {
    // 最初の応答が返った直後に一度だけタイトルを自動生成する
    if (msgs.length !== 2) return;
    try {
      const res = await fetch("/api/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: leanMessages(msgs) }),
      });
      if (!res.ok) return;
      const j = await res.json().catch(() => ({}));
      if (j?.title) await persistSession(sessionId, msgs, String(j.title).slice(0, 30));
    } catch {}
  };

  const ensureSession = (): string => {
    if (currentId) return currentId;
    const id = newId();
    setCurrentId(id);
    return id;
  };

  const send = async () => {
    const text = input.trim();
    if (streaming) return;
    if (!text && attachments.length === 0) return;
    if (recording) recognitionRef.current?.stop();
    const sessionId = ensureSession();
    const userMsg: Msg = {
      role: "user",
      content: text || (attachments.length > 0 ? "（資料を添付しました）" : ""),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    const afterUser: Msg[] = [...messages, userMsg];
    setMessages(afterUser);
    setInput("");
    setAttachments([]);
    setAttachErr("");
    setStreaming(true);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);
    requestAnimationFrame(autoGrow);

    persistSession(sessionId, afterUser).catch(() => {});

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: afterUser, mode }),
      });
      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => "");
        throw new Error(err || "response error");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
      const finalMsgs: Msg[] = [...afterUser, { role: "assistant", content: acc }];
      persistSession(sessionId, finalMsgs).catch(() => {});
      maybeGenerateTitle(sessionId, finalMsgs);
    } catch {
      const fallback: Msg = {
        role: "assistant",
        content: "少し通信が途切れたようです。\nもう一度、やさしく送ってみてください。",
      };
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = fallback;
        return copy;
      });
      persistSession(sessionId, [...afterUser, fallback]).catch(() => {});
    } finally {
      setStreaming(false);
    }
  };

  const startNewSession = () => {
    setMessages([]);
    setCurrentId(null);
    setInput("");
    setAttachments([]);
    setSidebarOpen(false);
    requestAnimationFrame(autoGrow);
  };

  const openSession = (s: Session) => {
    setMessages(s.messages);
    setCurrentId(s.id);
    setSidebarOpen(false);
  };

  const startEditTitle = (id: string, current: string) => {
    setEditingId(id);
    setEditingValue(current);
  };
  const commitEditTitle = () => {
    if (editingId) renameSession(editingId, editingValue);
    setEditingId(null);
  };

  const startEditHeaderTitle = (current: string) => {
    setEditingHeader(true);
    setEditingValue(current);
  };
  const commitEditHeaderTitle = () => {
    if (currentId) renameSession(currentId, editingValue);
    setEditingHeader(false);
  };

  const requestDelete = (id: string, title: string) => setConfirmDelete({ id, title });

  const confirmDeleteNow = async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    const { error } = await supabase.from("sessions").delete().eq("id", id);
    if (error) return;
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentId === id) startNewSession();
  };

  const downloadSession = (s: Session) => {
    const lines = [s.title, `保存日: ${formatDate(s.updated_at)}`, ""];
    for (const m of s.messages) {
      lines.push(m.role === "user" ? "【あなた】" : "【コーチ】");
      lines.push(m.content);
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(s.title || "対話").slice(0, 40)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setMessages([]);
    setCurrentId(null);
    setSessions([]);
  };

  const filteredSessions = sessions.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    if (s.title.toLowerCase().includes(q)) return true;
    return s.messages.some((m) => m.content.toLowerCase().includes(q));
  });
  const groups = groupSessions(filteredSessions);
  const currentTitle = sessions.find((s) => s.id === currentId)?.title;

  return (
    <div className="app-shell">
      <div className={`sidebar-overlay${sidebarOpen ? " open" : ""}`} onClick={() => setSidebarOpen(false)} />
      <div className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="threads-band" />
        <div className="sidebar-brand">Tapestry Circle</div>
        <div className="sidebar-sub">AI コーチ</div>
        <button className="newchat-btn" onClick={startNewSession}>
          ＋ 新しい対話
        </button>
        {sessions.length > 3 && (
          <input
            className="sidebar-search"
            placeholder="対話をさがす"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        <div className="sidebar-sessions">
          {groups.length === 0 ? (
            <div className="sidebar-empty">まだ記録はありません。</div>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <div className="grouplabel">{g.label}</div>
                {g.items.map((s) => (
                  <div
                    key={s.id}
                    className={`session-row${s.id === currentId ? " active" : ""}`}
                    onClick={() => (editingId === s.id ? undefined : openSession(s))}
                  >
                    {editingId === s.id ? (
                      <input
                        className="session-row-input"
                        value={editingValue}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onBlur={commitEditTitle}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEditTitle();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                    ) : (
                      <span className="session-row-title">{s.title}</span>
                    )}
                    <span
                      className="session-row-edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditTitle(s.id, s.title);
                      }}
                      title="タイトルを変更"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </span>
                    <span
                      className="session-row-edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadSession(s);
                      }}
                      title="この対話をダウンロード"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </span>
                    <span
                      className="session-row-del"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDelete(s.id, s.title);
                      }}
                    >
                      ×
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="sidebar-foot">
          <span className="sidebar-foot-email">{user.email}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <button className="theme-toggle" onClick={toggleTheme} title="明るさを切り替え" aria-label="明るさを切り替え">
              {resolvedTheme === "dark" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <button className="sidebar-foot-signout" onClick={signOut}>
              サインアウト
            </button>
          </div>
        </div>
      </div>

      <div className="main">
        <div className="main-header">
          <span className="hamburger" onClick={() => setSidebarOpen(true)}>
            ☰
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="main-header-eyebrow">TAPESTRY CIRCLE</div>
            {editingHeader ? (
              <input
                className="main-header-title-input"
                value={editingValue}
                autoFocus
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={commitEditHeaderTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEditHeaderTitle();
                  if (e.key === "Escape") setEditingHeader(false);
                }}
              />
            ) : (
              <div
                className={`main-header-title${currentTitle ? " editable" : ""}`}
                onClick={() => currentTitle && startEditHeaderTitle(currentTitle)}
                title={currentTitle ? "クリックしてタイトルを変更" : undefined}
              >
                {currentTitle || "新しい対話"}
                {currentTitle && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 7, flexShrink: 0, opacity: 0.7 }}>
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="messages-scroll">
          <div className="messages">
            {messages.length === 0 && (
              <div className="empty-hero">
                今、心にあることを、
                <br />
                そのまま置いてみてください。
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role === "user" ? "user" : "ai"}`}>
                {m.attachments && m.attachments.length > 0 && (
                  <div className="msg-files">
                    {m.attachments.map((a, j) => (
                      <span key={j} className="file-chip saved">
                        📎 {a.name}
                      </span>
                    ))}
                  </div>
                )}
                {m.content ||
                  (streaming && i === messages.length - 1 ? (
                    <span className="thinking">
                      <span className="typing" /> 静かに、言葉を紡いでいます…
                    </span>
                  ) : (
                    ""
                  ))}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="composer-wrap">
          {attachments.length > 0 && (
            <div className="attach-preview">
              {attachments.map((a, i) => (
                <span key={i} className="file-chip">
                  📎 {a.name}
                  <button type="button" onClick={() => removeAttachment(i)} aria-label="添付を外す">
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {attachErr && <div className="attach-err">{attachErr}</div>}

          <div className="composer-box">
            <textarea
              ref={textareaRef}
              className="composer-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!streaming && (input.trim() || attachments.length > 0)) send();
                }
              }}
              placeholder="ここに、そっと置いてみてください…（PDF・Word・Excel・写真も置けます）"
              rows={1}
              autoFocus
            />
            <div className="composer-controls">
              <div className="composer-controls-left">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => onPickFiles(e.target.files)}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => fileRef.current?.click()}
                  title="資料を添付（PDF・Word・Excel・写真など）"
                  disabled={streaming}
                >
                  ＋
                </button>
                {speechSupportedRef.current && (
                  <button
                    type="button"
                    className={`icon-btn${recording ? " recording" : ""}`}
                    onClick={toggleRecording}
                    title={recording ? "録音を止める" : "話しかけて入力する"}
                    disabled={streaming}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0 0 14 0" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="composer-controls-right">
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="mode-pill"
                    onClick={() => setModeMenuOpen((v) => !v)}
                  >
                    <span className="mode-pill-dot" style={{ background: MODE_INFO[mode].dot }} />
                    {MODE_INFO[mode].label}
                  </button>
                  {modeMenuOpen && (
                    <>
                      <div
                        style={{ position: "fixed", inset: 0, zIndex: 15 }}
                        onClick={() => setModeMenuOpen(false)}
                      />
                      <div className="mode-menu">
                        {(Object.keys(MODE_INFO) as Mode[]).map((m) => (
                          <button key={m} className="mode-menu-item" onClick={() => chooseMode(m)}>
                            <div className="mode-menu-item-label">
                              <span className="mode-pill-dot" style={{ background: MODE_INFO[m].dot }} />
                              {MODE_INFO[m].label}
                            </div>
                            <div className="mode-menu-item-desc">{MODE_INFO[m].desc}</div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className="send-btn"
                  onClick={send}
                  disabled={streaming || (!input.trim() && attachments.length === 0)}
                  title="送る"
                  aria-label="送る"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="6 11 12 5 18 11" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">この記録を削除しますか</div>
            <div className="modal-body">「{confirmDelete.title}」を削除します。元には戻せません。</div>
            <div className="modal-actions">
              <button className="modal-btn-cancel" onClick={() => setConfirmDelete(null)}>
                やめる
              </button>
              <button className="modal-btn-danger" onClick={confirmDeleteNow}>
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
