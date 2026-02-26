export async function chat(message) {
  const base = import.meta.env.VITE_API_BASE || "http://localhost:3001";

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${txt}`);
  }

  return res.json(); // { answer, sources }
}