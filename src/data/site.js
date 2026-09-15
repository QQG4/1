/* Настройки сайта. Пустые значения выключают соответствующие кнопки и отправку статистики. */
KZ.site = {
  feedbackTelegram: '',            // например 'qazaq_trainer' → кнопка «Написать в Telegram» после теста (https://t.me/<handle>)
  analyticsSnippet: '',            // тег скрипта приватной аналитики без cookies (Cloudflare Web Analytics / GoatCounter / Umami);
                                   // вставляется build.py только в публичную сборку сайта
  // приёмник событий (Cloudflare Worker, tools/events-worker): «начал раздел», «завершил раздел», разбор по вопросам;
  // пусто → не отправляется ничего. При смене адреса сайта добавить новый домен в ALLOWED в worker.js и задеплоить заново.
  eventsUrl: 'https://qazaq-trainer-stats.k-k-g-inter.workers.dev',
  siteUrl: 'https://qazaqtrainer.com/'   // адрес опубликованного сайта (canonical, og:image, ссылка «открыть отдельной вкладкой»)
};
