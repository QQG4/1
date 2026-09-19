/* Настройки сайта. Пустые значения выключают соответствующие кнопки и отправку статистики. */
KZ.site = {
  feedbackTelegram: '',            // например 'qazaq_trainer' → кнопка «Написать в Telegram» после теста (https://t.me/<handle>)
  analyticsSnippet: '',            // тег скрипта приватной аналитики без cookies (Cloudflare Web Analytics / GoatCounter / Umami);
                                   // вставляется build.py только в публичную сборку сайта
  // приёмник событий (Cloudflare Worker, tools/events-worker): «начал раздел», «завершил раздел», разбор по вопросам;
  // пусто → не отправляется ничего. При смене адреса сайта добавить новый домен в ALLOWED в worker.js и задеплоить заново.
  eventsUrl: 'https://qazaq-trainer-stats.k-k-g-inter.workers.dev',
  telegramChannel: 'qazaqtrainer',           // канал напоминаний о датах регистрации и об окне апелляции (2 рабочих дня):
                                 // 'qazaqtrainer' → блок после раздела и ссылка в подвале. Пусто — блок не показывается
  googleVerify: '',              // код из Google Search Console (метод «HTML-тег»: только значение content). Пусто — тега нет
  yandexVerify: 'd1e12955c643a35d',              // код из Яндекс.Вебмастера (метод «Метатег»: только значение content)
  supportEmail: 'support@qazaqtrainer.com',   // Cloudflare Email Routing → пересылка на Gmail владельца (16.09.2026); показывается в подвале, на 404 и в анкете эксперта
  siteUrl: 'https://qazaqtrainer.com/'   // адрес опубликованного сайта (canonical, og:image, ссылка «открыть отдельной вкладкой»)
};
