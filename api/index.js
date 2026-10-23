export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('OK', { status: 200 });

  try {
    const body = await req.json();
    const userText = body.request?.original_utterance?.trim() || '';
    const history = body.state?.session?.history || [];

    if (!userText || body.session?.new) {
      return new Response(JSON.stringify({
        version: body.version,
        session: body.session,
        response: { text: 'Привет! Я на связи. О чём поговорим?', end_session: false },
        session_state: { history: [] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const contents = [...history, { role: 'user', parts: [{ text: userText }] }];
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2700);

    let replyText = "";

    try {
      const geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: 'Отвечай в 1 предложение.' }] },
          generationConfig: { maxOutputTokens: 30 },
          contents,
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const geminiData = await geminiRes.json();
      if (geminiData.error) {
         replyText = `Ошибка API: ${geminiData.error.message}`;
      } else if (geminiData?.candidates?.[0]?.content?.parts?.[0]?.text) {
         replyText = geminiData.candidates[0].content.parts[0].text;
      } else {
         replyText = `Пустой ответ. Данные: ${JSON.stringify(geminiData).slice(0, 50)}`;
      }
    } catch (e) {
      replyText = e.name === 'AbortError' ? 'Не успела за 2.7 секунды.' : `Сбой сети: ${e.message}`;
    }

    const updatedHistory = [
      ...history,
      { role: 'user', parts: [{ text: userText.slice(0, 100) }] },
      { role: 'model', parts: [{ text: replyText.slice(0, 100) }] },
    ].slice(-4);

    return new Response(JSON.stringify({
      version: body.version,
      session: body.session,
      response: { text: replyText, end_session: false },
      session_state: { history: updatedHistory },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ response: { text: 'Ошибка', end_session: false } }), { status: 200 });
  }
}
