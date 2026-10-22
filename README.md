# أنجز — طباعة ذكية مع RAG معزول لكل شركة

منصة عربية لإدارة منتجات الطباعة، مع قاعدة معرفة مستقلة لكل شركة. الاسترجاع الدلالي يحدث على الخادم بعد التحقق من جلسة المستخدم؛ `company_id` القادم من المتصفح يُتجاهل.

## التشغيل

```bash
cp .env.example .env
# أضف مفاتيح التضمين واللغة ثم:
npm install
npm run dev
```

- الواجهة: http://127.0.0.1:5173
- واجهة البرمجة: http://127.0.0.1:8787

### حسابات تجريبية

| الشركة | البريد | كلمة المرور |
| --- | --- | --- |
| المراعي (إدارة المعرفة) | nasser@almarai.com | AnjzDemo!26 |
| المراعي (عضو: سؤال فقط) | hind@almarai.com | AnjzDemo!26 |
| قمم للفعاليات (إدارة المعرفة) | fahd@qimam.sa | AnjzDemo!26 |

كل شركة لها سياسة طباعة مختلفة في `server/fixtures`. استعلام المراعي لا يعيد مقاطع قمم حتى لو أُرسل `company_id` في جسم الطلب.

## مفاتيح التضمين واللغة وGemini

انسخ المثال ثم ضع المفتاح من [Google AI Studio](https://aistudio.google.com/api-keys):

```bash
cp .env.example .env
# حرّر .env وأضف GEMINI_API_KEY فقط على الخادم
```

أعد تشغيل `npm run dev`. اختبر النص والتضمين وتوليد الصور كلٌّ على حدة (فشل الصورة لا يعني فشل النص).

مع `GEMINI_API_KEY` و`EMBEDDING_BASE_URL` / `LLM_BASE_URL` فارغين يستدعي الخادم Gemini REST (`generateContent` / `embedContent` / `batchEmbedContents`) بمفتاح في ترويسة `x-goog-api-key`. لا يُرسل المفتاح للمتصفح. إن ضبطت `EMBEDDING_BASE_URL` يُستخدم عميل متوافق مع OpenAI على ذلك العنوان بدل Gemini.

| المتغير | الغرض |
| --- | --- |
| `GEMINI_API_KEY` | نص، تضمين، وصورة Gemini على الخادم |
| `GEMINI_TEXT_MODEL` | الافتراضي `gemini-3.8-flash` |
| `GEMINI_EMBEDDING_MODEL` | الافتراضي `gemini-embedding-001` |
| `GEMINI_IMAGE_MODEL` | الافتراضي `gemini-nano-banana-2.1` عبر Gemini Interactions API (يتطلب إتاحته للمشروع) |
| `EMBEDDING_API_KEY` / `LLM_API_KEY` | إعدادات مزودي نص/تضمين متوافقين مع OpenAI عند الحاجة؛ صور التصميم تستخدم Gemini فقط |
| `EMBEDDING_BASE_URL` / `LLM_BASE_URL` | فارغ = Gemini الأصلي؛ أو عنوان OpenAI/Ollama `/v1` |
| `EMBEDDING_DIMENSIONS` | يجب أن يطابق كل المتجهات المخزّنة |

### أبعاد التضمين — لا تخلط النماذج

- المخزن الحالي وعمود Postgres: `vector(1536)`.
- `gemini-embedding-001` يدعم 768 و1536 و3072. المثال يستخدم 768 محلياً.
- إن وُجدت متجهات بأبعاد مختلفة يرفض الفهرسة/السؤال بـ `409 EMBEDDING_DIMENSION_MISMATCH`.
- للانتقال من OpenAI 1536 إلى Gemini 768 محلياً: أوقف الخادم، احذف `data/anjz.sqlite` (أو أعد رفع كل المستندات بعد حذف المعرفة)، ثم شغّل من جديد.
- لPostgres: إما أبقِ `EMBEDDING_DIMENSIONS=1536` مع Gemini، أو `DELETE` من `chunks` ثم `ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(768)` قبل إعادة الفهرسة. لا تُغيَّر الأبعاد تلقائياً.

لا يوجد مسار إنتاج يستخدم بحث كلمات أو متجهات وهمية.

### إن غابت المفاتيح أو فشل المزود

- `GET /api/health` يوضح `embeddingsConfigured` و `llmConfigured` دون طباعة المفاتيح.
- رفع ملف مع فشل التضمين يعيد `503` ويبقي المستند بحالة `error` مع الرسالة. لا يُعرض كنجاح.
- السؤال يعيد `503` ورمز `EMBEDDINGS_UNAVAILABLE` إذا تعذر تضمين السؤال.
- إذا نجح الاسترجاع وفشل نموذج اللغة: `503` ورمز `LLM_UNAVAILABLE` مع المصادر دون إجابة مولَّدة.
- إن لم تُسترجع مقاطع كافية داخل نطاق الشركة: `200` مع التصريح بعدم كفاية المعلومة، بلا تخمين.

## مخزن المتجهات

### تطوير محلي (الافتراضي)

`VECTOR_BACKEND=sqlite` يخزن المتجهات في `data/anjz.sqlite`. البحث يحمّل **مقاطع الشركة الحالية فقط** ثم يحسب تشابه جيب التمام.

### Postgres + pgvector

```bash
docker compose up -d
```

في `.env`:

```
VECTOR_BACKEND=postgres
DATABASE_URL=postgres://anjz:anjz@127.0.0.1:5432/anjz
```

المخطط والفهارس في `server/db/schema.postgres.sql`:

- فلترة إلزامية `WHERE chunks.company_id = $1 AND documents.company_id = $1`
- فهرس `hnsw` على `embedding`
- حذف المقاطع مع المستند (`ON DELETE CASCADE` + حذف صريح عند الحذف المنطقي)
- انتهاء الصلاحية: `expires_at` ثم `purgeExpired` عند الإقلاع (المدة من `DOCUMENT_RETENTION_DAYS`)

## الملفات المدعومة

`.txt` `.md` `.csv` `.pdf` `.docx` `.html` — استخراج نص، تقسيم متداخل، وبيانات وصفية: `company_id`، اسم الملف، تاريخ الإضافة.

## الهوية، التقويم، والتذكير، واستوديو Gemini

المسار: عدة الهوية (مع شعار كملف) → مناسبات في `Asia/Riyadh` → تنبيهات داخل التطبيق → قالب SVG يحمل الشعار والألوان، مع خلفية نقطية فقط إن نجح مزود الصور.

لا يوجد Supabase في التشغيل الافتراضي. الشعارات تُحفظ تحت `data/uploads/logos/{company_id}/`. إن وُجدت `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` يُرفع نسخة إضافية عبر Storage REST. مخطط SQL الاختياري: `server/db/schema.supabase.sql`.

التذكير: يُشغَّل عند فتح التقويم/التنبيهات، وكذلك عبر:

```
curl -X POST http://127.0.0.1:8787/api/internal/cron/reminders \
  -H "Authorization: Bearer $CRON_SECRET"
```

بدون `CRON_SECRET` المسار يعيد 503. البريد لا يُرسل ما لم يُضبط مزود لاحقاً (`SMTP_URL` مكان التكامل فقط).

`GEMINI_API_KEY` يبقى على الخادم. إن غاب، يُستخدم LLM المضبوط إن وُجد للنصوص، ويبقى التصميم قالب SVG صادقاً (ليس صورة مزيفة).

## الاختبارات

```bash
npm test
```

تغطي عزل المستأجرين، التلاعب بـ `company_id` في الطلب، منع الحذف عبر الشركات، وسلوك غياب المفاتيح.

## توليد تصميم بالذكاء الاصطناعي

كل تصميم محفوظ هو قالب SVG يحمل شعار الشركة وألوان الهوية ونصوصاً مُهرَّبة. إن نجح `GEMINI_API_KEY` تُستخدم صورة Gemini كخلفية فقط، مع ملاحظة صريحة في المعاينة. إن غاب المزود لا تُعرض صورة ملفّقة.

حدود التوليد: 8 طلبات لكل مستخدم كل 10 دقائق عبر `/api/designs/compose`. التصدير المتاح: SVG وPNG من المعاينة. PDF بbleed وCMYK غير مطبَّقين.

## واجهة المعرفة

`/knowledge`: رفع، حالة المعالجة، إعادة فهرسة من الملف الأصلي المخزّن حسب الشركة، حذف، وسؤال مع مصادر (اسم المستند ورقم المقطع). سجلات التدقيق تسجّل الإجراء والمعرّفات فقط، دون نص السؤال أو محتوى الملفات.
