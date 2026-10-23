
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const json = (data) =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });

  if (req.method !== 'POST') {
    return new Response('OK', { status: 200 });
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return json({
      response: {
        text: 'Не удалось прочитать запрос. Попробуй ещё раз.',
        end_session: false,
      },
    });
  }

  const userText = body.request?.original_utterance?.trim() || '';
  const history = Array.isArray(body.state?.session?.history)
    ? body.state.session.history
    : [];

  if (body.session?.new || !userText) {
    return json({
      version: body.version,
      session: body.session,
      response: {
        text: 'Привет! Я на связи. О чём поговорим?',
        end_session: false,
      },
      session_state: { history: [] },
    });
  }

  const messages = [
    {
      role: 'system',
      content:
        'Ты ассистент в Яндекс Алисе. Отвечай по-русски, кратко и естественно, обычно в 1-2 предложениях.',
    },
    ...history.filter(
      (item) =>
        item &&
        ['user', 'assistant'].includes(item.role) &&
        typeof item.content === 'string' &&
        item.content.length > 0
    ),
    { role: 'user', content: userText.slice(0, 1000) },
  ];

  let replyText = '';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2800);

  try {
    const res = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'qwen/qwen-2.5-7b-instruct:free',
          messages,
          max_tokens: 300,
        }),
        signal: controller.signal,
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error('OpenRouter HTTP error:', res.status, data.error?.message);
      replyText = 'Сейчас не получилось получить ответ. Попробуй ещё раз.';
    } else if (data.choices?.[0]?.message?.content) {
      const content = data.choices[0].message.content;
      replyText = (
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.map((part) => part.text || '').join('')
            : ''
      )
        .replace(/[*#`]/g, '')
        .trim();
    } else {
      console.error('OpenRouter returned no text:', JSON.stringify(data).slice(0, 500));
      replyText = 'Я получила пустой ответ. Попробуй спросить ещё раз.';
    }
  } catch (error) {
    console.error('OpenRouter request failed:', error?.name, error?.message);
    replyText =
      error?.name === 'AbortError'
        ? 'Ответ задерживается. Попробуй ещё раз.'
        : 'Не удалось связаться с моделью. Попробуй ещё раз.';
  } finally {
    clearTimeout(timeoutId);
  }

  if (!replyText) {
    replyText = 'Не получилось подготовить ответ. Попробуй ещё раз.';
  }

  const updatedHistory = [
    ...history.filter(
      (item) =>
        item &&
        ['user', 'assistant'].includes(item.role) &&
        typeof item.content === 'string' &&
        item.content.length > 0
    ),
    { role: 'user', content: userText.slice(0, 100) },
    { role: 'assistant', content: replyText.slice(0, 100) },
  ].slice(-6);

  return json({
    version: body.version,
    session: body.session,
    response: {
      text: replyText.slice(0, 1000),
      end_session: false,
    },
    session_state: { history: updatedHistory },
  });
}
