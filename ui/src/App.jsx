import { useMemo, useRef, useState } from "react";
import "./App.css";
import { chat } from "./api";

function Header() {
  return (
    <header className="hdr">
      <div className="hdr__inner">
        <div className="hdr__brand">
          <div className="hdr__logo">E</div>
          <div className="hdr__title">
            <div className="hdr__name">Edirne Belediyesi</div>
            <div className="hdr__sub">Yapay Zekâ Asistanı (Demo)</div>
          </div>
        </div>

        <nav className="hdr__nav">
          <a href="#" onClick={(e) => e.preventDefault()}>
            Kurumsal
          </a>
          <a href="#" onClick={(e) => e.preventDefault()}>
            Hizmet Rehberi
          </a>
          <a href="#" onClick={(e) => e.preventDefault()}>
            İletişim
          </a>
        </nav>
      </div>
    </header>
  );
}

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M21 12c0 4.418-4.03 8-9 8a10.6 10.6 0 0 1-2.4-.27L4 21l1.35-3.24A7.6 7.6 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8 12h.01M12 12h.01M16 12h.01"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Bubble({ role, text }) {
  return (
    <div className={`msg ${role === "user" ? "msg--user" : "msg--bot"}`}>
      <div className="msg__bubble">{text}</div>
    </div>
  );
}

export default function App() {
  const [open, setOpen] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const [messages, setMessages] = useState(() => [
    {
      role: "bot",
      text: "Merhaba! Edirne Belediyesi ile ilgili sorularınızı yanıtlayabilirim. 😊",
    },
  ]);

  const [sources, setSources] = useState([]);
  const [showSources, setShowSources] = useState(false);

  const endRef = useRef(null);

  const canSend = useMemo(
    () => input.trim().length > 0 && !busy,
    [input, busy]
  );

  async function send() {
    if (!canSend) return;

    const text = input.trim();
    setInput("");
    setShowSources(false);

    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);

    try {
      const data = await chat(text); 
      setMessages((m) => [
        ...m,
        { role: "bot", text: data.answer || "Bu bilgi kaynaklarda bulunamadı." },
      ]);
      setSources(Array.isArray(data.sources) ? data.sources : []);
    } catch (e) {
      console.error(e);
      setMessages((m) => [
        ...m,
        {
          role: "bot",
          text: "Şu an cevap veremiyorum. Backend (localhost:3001) çalışıyor mu kontrol eder misin?",
        },
      ]);
      setSources([]);
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <div className="page">
      <Header />

      <main className="hero">
        <div className="hero__content">
          <h1>Edirne Belediyesi Dijital Asistan Demo</h1>
          <p>
            Bu ekran belediye sitesine gömmeden önce yapılan demo arayüzüdür.
            Sağ alttaki sohbet butonuna tıklayarak sorularınızı sorabilirsiniz.
          </p>

          <div className="cards">
            <div className="card">
              <div className="card__title">Örnek Sorular</div>
              <ul>
                <li>Belediyeye nasıl iletişime geçebilirim?</li>
                <li>Toplanma alanları nereler?</li>
                <li>Muhtarlar listesi var mı?</li>
              </ul>
            </div>

            <div className="card">
              <div className="card__title">Not</div>
              <p>
                Cevaplar yalnızca belediye kaynaklarından üretilir.
                Kaynaklar panelden görüntülenebilir.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Floating Button */}
      <button className="fab" onClick={() => setOpen((v) => !v)} aria-label="Chat">
        <ChatIcon />
      </button>

      {/* Chat Panel */}
      {open && (
        <section className="panel" role="dialog" aria-label="Chat panel">
          <div className="panel__top">
            <div className="panel__title">
              <div className="panel__dot" />
              Edirne AI Asistan
            </div>
            <button className="panel__close" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="panel__msgs">
            {messages.map((m, i) => (
              <Bubble key={i} role={m.role} text={m.text} />
            ))}
            <div ref={endRef} />
          </div>

          <div className="panel__actions">
            <button
              className="srcBtn"
              onClick={() => setShowSources((v) => !v)}
              disabled={sources.length === 0}
              title={sources.length ? "Kaynakları göster" : "Kaynak yok"}
            >
              Kaynaklar ({sources.length})
            </button>

            {showSources && sources.length > 0 && (
              <div className="sources">
                {sources.map((s, idx) => (
                  <a key={idx} className="sources__item" href={s} target="_blank" rel="noreferrer">
                    {s}
                  </a>
                ))}
              </div>
            )}

            <div className="panel__inputRow">
              <input
                className="panel__input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Sorunu yaz..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
              />
              <button className="panel__send" onClick={send} disabled={!canSend}>
                {busy ? "..." : "Gönder"}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}