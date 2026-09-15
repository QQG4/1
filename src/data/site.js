/* Настройки сайта. Пустые значения выключают соответствующие кнопки и отправку статистики. */
KZ.site = {
  feedbackTelegram: '',            // например 'qazaq_trainer' → кнопка «Написать в Telegram» после теста (https://t.me/<handle>)
  analyticsSnippet: '',            // тег скрипта приватной аналитики без cookies (Cloudflare Web Analytics / GoatCounter / Umami);
                                   // вставляется build.py только в публичную сборку сайта
  eventsUrl: '',                   // адрес своего приёмника событий (Cloudflare Worker, tools/events-worker) —
                                   // сюда уходят «начал раздел», «завершил раздел» и разбор по вопросам; пусто → не отправляется
  siteUrl: 'https://qqg4.github.io/1/'   // адрес опубликованного сайта (canonical, og:image, ссылка «открыть отдельной вкладкой»)
};
