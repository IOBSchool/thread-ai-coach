"use client";

import { useEffect, useRef, useState } from "react";
import type { Session as AuthSession, User } from "@supabase/supabase-js";
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
type View = "chat" | "mypage" | "viewing";

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

export default function Page() {
  const supabase = getSupabase();

  // auth
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  const [view, setView] = useState<View>("chat");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachErr, setAttachErr] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const MAX_BYTES = 4 * 1024 * 1024;
  const ALLOWED = [
    "application/pdf",
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
        setAttachErr(`${f.name} は対応していない形式です（PDF/画像のみ）`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        setAttachErr(`${f.name} はサイズが大きすぎます（4MBまで）`);
        continue;
      }
      totalBytes += f.size;
      if (totalBytes > MAX_BYTES) {
        setAttachErr("合計サイズが4MBを超えました");
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

    return () => {
      sub.subscription.unsubscribe();
    };
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

  if (authLoading) {
    return (
      <>
        <div className="thread-line" />
        <div className="gate">
          <div className="gate-card">
            <div className="logo-t">T</div>
          </div>
        </div>
      </>
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
      <>
        <div className="thread-line" />
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
              <div style={{ color: "var(--ink-mid)", fontSize: 13, lineHeight: 2, marginTop: 24 }}>
                <strong style={{ color: "var(--thread)" }}>{email}</strong>
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
                    color: "var(--ink-soft)",
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
      </>
    );
  }

  const ensureSession = (): string => {
    if (currentId) return currentId;
    const id = newId();
    setCurrentId(id);
    return id;
  };

  const persistSession = async (sessionId: string, msgs: Msg[], title?: string) => {
    if (!user) return;
    const lean = leanMessages(msgs);
    const existing = sessions.find((s) => s.id === sessionId);
    if (existing) {
      const patch: any = { messages: lean, updated_at: new Date().toISOString() };
      if (title) patch.title = title;
      const { error } = await supabase.from("sessions").update(patch).eq("id", sessionId);
      if (!error) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, ...patch, messages: lean } : s)),
        );
      }
    } else {
      const row = {
        id: sessionId,
        user_id: user.id,
        title: title ?? "（タイトル未設定）",
        messages: lean,
      };
      const { data, error } = await supabase.from("sessions").insert(row).select().single();
      if (!error && data) {
        setSessions((prev) => [data as Session, ...prev]);
      }
    }
  };

  const send = async () => {
    const text = input.trim();
    if (streaming) return;
    if (!text && attachments.length === 0) return;
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

    // ユーザー発話時点で先に保存（途中で離脱しても残る）
    persistSession(sessionId, afterUser).catch(() => {});

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: afterUser }),
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
    } catch (e: any) {
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

  const closeSession = async () => {
    if (!currentId || messages.length === 0) {
      setMessages([]);
      setCurrentId(null);
      return;
    }
    if (!confirm("この対話を一度とじて、マイページに保存しますか？")) return;
    setClosing(true);
    let title = "";
    try {
      const res = await fetch("/api/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: leanMessages(messages) }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j?.title) title = String(j.title).slice(0, 30);
      }
    } catch {}
    if (!title) {
      const firstUser = messages.find((m) => m.role === "user");
      title = firstUser?.content.slice(0, 20) || "対話の記録";
    }
    await persistSession(currentId, messages, title);
    setMessages([]);
    setCurrentId(null);
    setClosing(false);
  };

  const startNewSession = () => {
    setMessages([]);
    setCurrentId(null);
    setView("chat");
  };

  const openSession = (id: string) => {
    setViewingId(id);
    setView("viewing");
  };

  const deleteSession = async (id: string) => {
    if (!confirm("この記録を削除しますか？")) return;
    const { error } = await supabase.from("sessions").delete().eq("id", id);
    if (error) return;
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (viewingId === id) {
      setViewingId(null);
      setView("mypage");
    }
  };

  const signOut = async () => {
    if (!confirm("ログアウトしますか？")) return;
    await supabase.auth.signOut();
    setMessages([]);
    setCurrentId(null);
    setSessions([]);
    setView("chat");
  };

  if (view === "mypage") {
    return (
      <>
        <div className="thread-line" />
        <div className="header">
          <div className="header-title">Tapestry Circle用 · マイページ</div>
          <div className="countdown" style={{ marginBottom: 4, marginTop: 6 }}>
            {user.email}
          </div>
        </div>
        <div className="page-wrap">
          <div className="page-actions">
            <button className="nav-btn" onClick={() => setView("chat")}>
              ← 対話にもどる
            </button>
            <button className="nav-btn" onClick={startNewSession}>
              ＋ 新しい対話をはじめる
            </button>
            <button className="nav-btn" onClick={signOut}>
              ログアウト
            </button>
          </div>
          <div className="mypage-title">これまでの対話</div>
          {sessions.length === 0 ? (
            <div className="empty">まだ記録はありません。</div>
          ) : (
            <ul className="session-list">
              {sessions.map((s) => (
                <li key={s.id} className="session-item">
                  <button className="session-link" onClick={() => openSession(s.id)}>
                    <div className="session-title">{s.title}</div>
                    <div className="session-meta">
                      {formatDate(s.updated_at)} · {s.messages.length}通
                    </div>
                  </button>
                  <button
                    className="session-del"
                    onClick={() => deleteSession(s.id)}
                    aria-label="削除"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }

  if (view === "viewing") {
    const s = sessions.find((x) => x.id === viewingId);
    return (
      <>
        <div className="thread-line" />
        <div className="header">
          <div className="header-title">Tapestry Circle用 · 記録</div>
          <div className="countdown">{s ? formatDate(s.updated_at) : ""}</div>
        </div>
        <div className="chat-wrap">
          <div className="page-actions" style={{ marginBottom: 24 }}>
            <button className="nav-btn" onClick={() => setView("mypage")}>
              ← マイページにもどる
            </button>
            {s && (
              <button
                className="nav-btn"
                onClick={() => {
                  setMessages(s.messages);
                  setCurrentId(s.id);
                  setView("chat");
                }}
              >
                この対話を続ける →
              </button>
            )}
          </div>
          {!s ? (
            <div className="empty">記録が見つかりませんでした。</div>
          ) : (
            <>
              <div className="viewing-title">{s.title}</div>
              <div className="messages">
                {s.messages.map((m, i) => (
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
                    {m.content}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="thread-line" />
      <div className="header">
        <div className="header-title">Tapestry Circle用 · THE THREAD AI Coach</div>
        <div className="header-nav">
          <button className="nav-btn" onClick={() => setView("mypage")}>
            マイページ
          </button>
          {messages.length > 0 && (
            <button className="nav-btn" onClick={closeSession} disabled={closing}>
              {closing ? "保存しています…" : "対話をとじて保存"}
            </button>
          )}
        </div>
      </div>

      <div className="chat-wrap">
        <div className="messages">
          {messages.length === 0 && (
            <div className="msg ai" style={{ textAlign: "center", opacity: 0.7 }}>
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

      <div className="composer">
        {attachments.length > 0 && (
          <div className="attach-preview">
            {attachments.map((a, i) => (
              <span key={i} className="file-chip">
                📎 {a.name}
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  aria-label="添付を外す"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {attachErr && <div className="attach-err">{attachErr}</div>}
        <div className="composer-inner">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => onPickFiles(e.target.files)}
          />
          <button
            type="button"
            className="attach-btn"
            onClick={() => fileRef.current?.click()}
            title="PDF・画像を添付"
            disabled={streaming}
          >
            ＋ 添付
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!streaming && (input.trim() || attachments.length > 0)) send();
              }
            }}
            placeholder="ここに、そっと置いてみてください…&#10;Shift + Enter で改行"
            rows={4}
            autoFocus
          />
        </div>
      </div>
    </>
  );
}
