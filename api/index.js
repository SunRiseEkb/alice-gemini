module.exports = async (req, res) => {
  // Разрешаем только POST-запросы от Яндекс Диалогов
  if (req.method !== 'POST') {
    return res.status(200).send('Сервер навыка Алисы работает!');
  }

  try {
    const { request, session, state, version } = req.body;
    const userText = request?.original_utterance?.trim() || '';
    const history = state?.session?.history || [];

    // 1. Приветствие при запуске навыка (без текста запроса)
    if (!userText || session?.new) {
      return res.status(200).json({
        version,
        session,
        response: {
          text: 'Привет! Я на связи. О чём поговорим?',
          end_session: false,
        },
        session_state: { history: [] },
      });
    }

    // 2. Если есть ключ Serper и запрос требует свежей информации (опционально)
    let searchContext = '';
    if (process.env.SERPER_API_KEY) {
      try {
        const serperRes = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': process.env.SERPER_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ q: userText, gl: 'ru', hl: 'ru', num: 3 }),
        });
        const serperData = await serperRes.json();
        if (serperData.organic) {
          searchContext = serperData.organic
            .map((item) => `${item.title}: ${item.snippet}`)
            .join('\n');
        }
      } catch (e) {
        console.error('Ошибка Serper:', e);
      }
    }

    // 3. Формируем историю диалога для Gemini
    const contents = [
      ...history,
      {
        role: 'user',
        parts: [
          {
            text: searchContext
              ? `Контекст из поиска:\n${searchContext}\n\nВопрос пользователя: ${userText}`
              : userText,
          },
        ],
      },
    ];

    // 4. Отправляем запрос в Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-8b:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [
            {
              text: 'Ты голосовой ассистент внутри Яндекс Алисы. Отвечай кратко (1-3 предложения), понятно на слух, без списков, звездочек и markdown-разметки.',
            },
          ],
        },
        contents,
      }),
    });

    const geminiData = await geminiRes.json();
    const replyText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.replace(/[*#`]/g, '') ||
      `Ошибка: ${geminiData?.error?.message || JSON.stringify(geminiData)} (Ключ найден: ${Boolean(process.env.GEMINI_API_KEY)})`;

    // 5. Сохраняем последние 6 реплик в память сессии Алисы (лимит Яндекса — 1 КБ)
    const updatedHistory = [
      ...history,
      { role: 'user', parts: [{ text: userText.slice(0, 150) }] },
      { role: 'model', parts: [{ text: replyText.slice(0, 150) }] },
    ].slice(-6);

    return res.status(200).json({
      version,
      session,
      response: {
        text: replyText.slice(0, 1024),
        end_session: false,
      },
      session_state: {
        history: updatedHistory,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(200).json({
      version: req.body?.version || '1.0',
      session: req.body?.session,
      response: {
        text: 'Произошла ошибка на сервере навыка.',
        end_session: false,
      },
    });
  }
};
