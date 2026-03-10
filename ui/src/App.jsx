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

const quickReplies = [
  { label: "🏠 Emlak vergisi", value: "Emlak vergisi nasıl ödenir?" },
  { label: "💧 Su aboneliği", value: "Su aboneliği nasıl yapılır?" },
  { label: "🚌 KentKart", value: "Kent kartımı kaybettim ne yapmalıyım?" },
  { label: "🤝 Sosyal yardımlar", value: "Sosyal yardım başvurusu nasıl yapılır?" },
  { label: "💍 Nikâh işlemleri", value: "Nikah işlemleri nasıl yapılır?" },
  { label: "⚰️ Cenaze ve defin", value: "Cenaze ve defin hizmetleri hakkında bilgi almak istiyorum." },
  { label: "📄 Askıda fatura", value: "Askıda fatura nedir?" },
  { label: "📞 İletişim", value: "Belediyeye nasıl ulaşabilirim?" },
  { label: "🚗 Otopark", value: "Otopark ücreti nasıl ödenir?" },
  { label: "🧺 Pazar yerleri", value: "Pazar yerleri nerede kuruluyor?" },
  { label: "💊 Nöbetçi eczane", value: "Nöbetçi eczane nerede?" },
  { label: "🚌 Güzergahlar", value: "Toplu taşıma güzergahlarını görmek istiyorum." },
];

function Bubble({
  role,
  text,
  links = [],
  showQuickReplies = false,
  onQuickReply,
  quickReplyDisabled = false,
}) {
  return (
    <div className={`msg ${role === "user" ? "msg--user" : "msg--bot"}`}>
      <div className="msg__bubble">
        <div>{text}</div>

        {Array.isArray(links) && links.length > 0 && (
          <div className="chatLinks">
            {links.map((link, i) => (
              <a
                key={`${link.url}-${i}`}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="chatLink"
              >
                {link.label}
              </a>
            ))}
          </div>
        )}

        {showQuickReplies && (
          <div className="quickReplies">
            {quickReplies.map((item, i) => (
              <button
                key={i}
                className="quickReplies__btn"
                onClick={() => onQuickReply(item.value)}
                disabled={quickReplyDisabled}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
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
    {
      role: "bot",
      text: "Aşağıdaki konularda size yardımcı olabilirim. Birini seçebilir veya sorunuzu yazabilirsiniz.",
      showQuickReplies: true,
    },
  ]);

  const endRef = useRef(null);

  const canSend = useMemo(
    () => input.trim().length > 0 && !busy,
    [input, busy]
  );

  function scrollToBottom() {
    setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }

  async function sendMessage(text) {
    const cleanText = text.trim();
    if (!cleanText || busy) return;

    setInput("");
    setMessages((m) => [...m, { role: "user", text: cleanText }]);
    setBusy(true);

    try {
      const data = await chat(cleanText);

      setMessages((m) => [
        ...m,
        {
          role: "bot",
          text: data.answer || "Bu bilgi kaynaklarda bulunamadı.",
          links: Array.isArray(data.links) ? data.links : [],
        },
      ]);
    } catch (e) {
      console.error(e);
      setMessages((m) => [
        ...m,
        {
          role: "bot",
          text: "Şu an cevap veremiyorum. Backend çalışıyor mu kontrol eder misin?",
          links: [],
        },
      ]);
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  }

  async function send() {
    if (!canSend) return;
    await sendMessage(input);
  }

  async function handleQuickReply(value) {
    await sendMessage(value);
  }

  return (
    <div className="page">
      <Header />

      <main className="hero">
        <div className="hero__content">
          <h1>Edirne Belediyesi Dijital Asistan Demo</h1>
          <p>
            Bu ekran belediye sitesine gömmeden önce yapılan demo arayüzüdür.
            Sağ alttaki sohbet butonuna tıklayarak belediye hizmetleriyle ilgili
            sorularınızı sorabilirsiniz.
          </p>

          <div className="cards">
            <div className="card">
              <div className="card__title">Örnek Konular</div>
              <ul>
                <li>Su aboneliği ve faturalar</li>
                <li>Nikâh işlemleri</li>
                <li>Vergi ödemeleri</li>
                <li>Otopark işlemleri</li>
              </ul>
            </div>

            <div className="card">
              <div className="card__title">Not</div>
              <p>
                Cevaplar belediye işlemleri için hazırlanmış yapılandırılmış bilgi
                kaynağına göre üretilir. Gerekli durumlarda ilgili sayfaya
                yönlendirme butonu gösterilir.
              </p>
            </div>
          </div>
        </div>
      </main>

      <button
        className="fab"
        onClick={() => setOpen((v) => !v)}
        aria-label="Chat"
      >
        <ChatIcon />
      </button>

      {open && (
        <section className="panel" role="dialog" aria-label="Chat panel">
          <div className="panel__top">
            <div className="panel__title">
              <div className="panel__dot" />
              Edirne AI Asistan
            </div>
            <button
              className="panel__close"
              onClick={() => setOpen(false)}
              aria-label="Close"
              type="button"
            >
              ✕
            </button>
          </div>

          <div className="panel__msgs">
            {messages.map((m, i) => (
              <Bubble
                key={i}
                role={m.role}
                text={m.text}
                links={m.links || []}
                showQuickReplies={m.showQuickReplies}
                onQuickReply={handleQuickReply}
                quickReplyDisabled={busy}
              />
            ))}

            {busy && <Bubble role="bot" text="Asistan yazıyor..." />}

            <div ref={endRef} />
          </div>

          <div className="panel__actions">
            <div className="panel__inputRow">
              <input
                className="panel__input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Sorunuzu yazın..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
              />
              <button
                className="panel__send"
                onClick={send}
                disabled={!canSend}
                type="button"
              >
                {busy ? "..." : "Gönder"}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}