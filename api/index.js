export const config = {
  runtime: 'edge', // Включает моментальный запуск сервера без задержек
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Сервер на Edge Runtime работает!', { status: 200 });
  }

  try {
    const body = await req.json();
    const { request, session, state, version } = body;
    const userText = request?.original_utterance?.trim() || '';
    const history = state?.session?.history || [];

    if (!userText || session?.new) {
      return new Response(JSON.stringify({
        version,
        session,
        response: { text: 'Привет! Я на связи. О чём поговорим?', end_session: false },
        session_state: { history: [] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const contents = [...history, { role: 'user', parts: [{ text: userText }] }];
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    // Ставим внутренний таймер на 2 секунды, чтобы успеть ответить Алисе до сброса
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    let replyText = "Чуть задумалась, не успела. Спроси еще раз, пожалуйста.";
    
    try {
      const geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: 'Ты ассистент в Алисе. Отвечай ОЧЕНЬ коротко (1 предложение), без списков и разметки.' }] },
          generationConfig: { maxOutputTokens: 30 },
          contents,
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      const geminiData = await geminiRes.json();
      if (geminiData?.candidates?.[0]?.content?.parts?.[0]?.text) {
         replyText = geminiData.candidates[0].content.parts[0].text.replace(/[*#`]/g, '');
      }
    } catch (e) {
      console.log('Gemini не успел ответить за 2 секунды');
    }

    const updatedHistory = [
      ...history,
      { role: 'user', parts: [{ text: userText.slice(0, 100) }] },
      { role: 'model', parts: [{ text: replyText.slice(0, 100) }] },
    ].slice(-4);

    return new Response(JSON.stringify({
      version,
      session,
      response: { text: replyText, end_session: false },
      session_state: { history: updatedHistory },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    
  } catch (error) {
    return new Response(JSON.stringify({
      version: '1.0',
      response: { text: 'Внутренняя ошибка сервера.', end_session: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}
