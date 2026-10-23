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

    const messages = [
      { role: 'system', content: 'Ты ассистент в Яндекс Алисе. Отвечай в 1-2 предложения, без списков.' },
      ...history,
      { role: 'user', content: userText }
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    let replyText = "";

    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`
        },
        body: JSON.stringify({
          model: 'nvidia/nemotron-3.5-lightning:free',
          messages: messages,
          max_tokens: 40
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (data.error) {
         replyText = `Ошибка: ${data.error.message}`;
      } else if (data.choices?.[0]?.message?.content) {
         replyText = data.choices[0].message.content.replace(/[*#`]/g, '');
      }
    } catch (e) {
      replyText = e.name === 'AbortError' ? 'Не успела за 2.7 секунды.' : `Сбой сети.`;
    }

    const updatedHistory = [
      ...history,
      { role: 'user', content: userText.slice(0, 100) },
      { role: 'assistant', content: replyText.slice(0, 100) },
    ].slice(-4);

    return new Response(JSON.stringify({
      version: body.version,
      session: body.session,
      response: { text: replyText, end_session: false },
      session_state: { history: updatedHistory },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ response: { text: 'Ошибка кода.', end_session: false } }), { status: 200 });
  }
}
