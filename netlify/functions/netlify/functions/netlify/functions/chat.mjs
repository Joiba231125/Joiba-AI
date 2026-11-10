const MODEL = "openai/gpt-oss-20b:fastest";
const SYSTEM_PROMPT = [
  "Eres Joiba AI, un asistente personal amable, claro y responsable.",
  "Responde en español salvo que la persona use otro idioma.",
  "Ayuda con preguntas generales, organización y estudio.",
  "Explica paso a paso y adapta la explicación a alguien que está aprendiendo.",
  "Si no sabes algo, dilo con claridad. No inventes búsquedas ni acciones externas.",
  "La memoria que se proporcione contiene preferencias elegidas por el usuario; úsala solo cuando sea relevante.",
  "No pidas contraseñas, datos bancarios ni información privada."
].join(" ");

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async (request) => {
  const hfToken = process.env.HF_TOKEN;
  const accessCode = process.env.JOIBA_ACCESS_CODE;

  if (request.method === "GET") {
    const configured = Boolean(hfToken && accessCode);
    return json({
      configured,
      message: configured
        ? "El servidor de Joiba está preparado."
        : "Falta configurar HF_TOKEN y JOIBA_ACCESS_CODE en las variables de entorno de Netlify."
    }, configured ? 200 : 503);
  }

  if (request.method !== "POST") return json({ message: "Método no permitido." }, 405);
  if (!hfToken || !accessCode) {
    return json({ message: "El servidor aún no está configurado. Añade HF_TOKEN y JOIBA_ACCESS_CODE en Netlify." }, 503);
  }

  const suppliedCode = request.headers.get("x-joiba-code") || "";
  if (!safeEqual(suppliedCode, accessCode)) return json({ message: "El código privado no coincide." }, 401);

  let body;
  try { body = await request.json(); }
  catch { return json({ message: "El mensaje no llegó en un formato válido." }, 400); }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ message: "Escribe un mensaje antes de enviar." }, 400);
  }

  const messages = body.messages
    .filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
    .slice(-12)
    .map(item => ({ role: item.role, content: item.content.slice(0, 3000) }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json({ message: "No se encontró un mensaje válido del usuario." }, 400);
  }

  const memories = Array.isArray(body.memories)
    ? body.memories.filter(item => typeof item === "string").slice(0, 20).map(item => item.slice(0, 180))
    : [];
  const systemMessage = memories.length
    ? `${SYSTEM_PROMPT}\nPreferencias guardadas por el usuario:\n- ${memories.join("\n- ")}`
    : SYSTEM_PROMPT;

  let upstream;
  try {
    upstream = await fetch("https://router.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${hfToken}`,
        "Content-Type": "application/json",
        "Accept": "text/event-stream"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: systemMessage }, ...messages],
        max_tokens: 240,
        temperature: 0.65,
        stream: true
      })
    });
  } catch (error) {
    return json({ message: "No se pudo contactar con el proveedor de IA. Revisa tu conexión e inténtalo de nuevo." }, 502);
  }

  if (!upstream.ok) {
    let detail = "";
    try { detail = (await upstream.text()).slice(0, 600); } catch (_) {}
    const messagesByStatus = {
      400: "La solicitud fue rechazada por el modelo. Prueba con un mensaje más corto.",
      401: "Hugging Face no aceptó el token. Comprueba HF_TOKEN y sus permisos.",
      402: "No hay crédito disponible para esta solicitud. Revisa el saldo de Inference Providers.",
      403: "El token no tiene permiso para Inference Providers o el modelo no está disponible.",
      429: "Se alcanzó un límite temporal de solicitudes. Espera un momento y vuelve a intentarlo.",
      503: "El proveedor de IA está ocupado temporalmente. Inténtalo otra vez en unos segundos."
    };
    return json({ message: messagesByStatus[upstream.status] || `El proveedor respondió con el error ${upstream.status}.`, detail }, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502);
  }

  if (!upstream.body) return json({ message: "El proveedor no devolvió una respuesta de texto." }, 502);
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no"
    }
  });
};
