/* Настройки сайта. Пустые значения выключают соответствующие кнопки и отправку статистики. */
KZ.site = {
  feedbackTelegram: '',            // например 'qazaq_trainer' → кнопка «Написать в Telegram» после теста (https://t.me/<handle>)
  analyticsSnippet: '',            // тег скрипта приватной аналитики без cookies (Cloudflare Web Analytics / GoatCounter / Umami);
                                   // вставляется build.py только в публичную сборку сайта
  // приёмник событий (Cloudflare Worker, tools/events-worker): «начал раздел», «завершил раздел», разбор по вопросам;
  // пусто → не отправляется ничего. При смене адреса сайта добавить новый домен в ALLOWED в worker.js и задеплоить заново.
  eventsUrl: 'https://qazaq-trainer-stats.k-k-g-inter.workers.dev',
  telegramChannel: 'qazaqtrainer',           // канал с «заданием дня»: ссылка в подвале. Пусто - ссылки нет (напоминания о ҚАЗТЕСТ убраны 23.11.2026)
  instagram: 'qazaq.trainer',     // значок Instagram на главной: https://www.instagram.com/<handle>/
  tiktok: 'qazaq.trainer',        // значок TikTok на главной: https://www.tiktok.com/@<handle>. Пусто - значка нет
  googleVerify: '',              // код из Google Search Console (метод «HTML-тег»: только значение content). Пусто - тега нет
  yandexVerify: 'd1e12955c643a35d',              // код из Яндекс.Вебмастера (метод «Метатег»: только значение content)
  supportEmail: 'support@qazaqtrainer.com',   // Cloudflare Email Routing → пересылка на Gmail владельца (16.09.2026); показывается в подвале, на 404 и в анкете эксперта
  writingReview: 'all',          // «Отправить на проверку команде» у эссе ҚАЗТЕСТ (пилот 15.11.2026): 'lab' - только в лаборатории (как раньше), 'all' - ещё и на публичном сайте
                                 // (запросы идут на eventsUrl, нужны воркер tools/events-worker с WRITING_KEY и миграция writing_*), false - нигде. Включает владелец; app.js сверяет флаг с build
  writingBot: 'qzqtrainer_bot',   // бот для уведомления «отчёт готов»: https://t.me/<бот>?start=w_<код без дефисов> 
  siteUrl: 'https://qazaqtrainer.com/'   // адрес опубликованного сайта (canonical, og:image, ссылка «открыть отдельной вкладкой»)
};
