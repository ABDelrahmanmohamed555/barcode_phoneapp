# Phone App - نظام المنتجات (محاكي موبايل)

بنية أساسية بنفس ستايل الكمبيوتر (#0d1117 + #c8943a) - Flutter لاحقاً، حالياً HTML للمعاينة السريعة.

## المعاينة
1. افتح `index.html` مباشرة في المتصفح (Chrome)
2. أو شغل سيرفر محلي:
   ```bash
   cd "/home/kali/Desktop/phone app"
   python3 -m http.server 8000
   # ثم افتح http://localhost:8000 أو http://YOUR_IP:8000 على الموبايل بنفس الشبكة
   ```
3. للـ responsive: في Chrome اضغط F12 → Toggle device toolbar (Ctrl+Shift+M) → اختر Pixel / iPhone

## الهيكل
```
phone app/
  index.html      # الواجهة (قائمة المنتجات + سلة + تفاصيل)
  style.css       # ثيم داكن + ذهبي مطابق لـ prot/config.py
  app.js          # منطق تجريبي (بحث، سكان وهمي، سلة)
  assets/         # أيقونات
```

## الخطوة التالية (Flutter المجاني)
عند تثبيت Flutter:
```bash
flutter create --project-name prot_phone .
# انسخ المنطق من app.js إلى lib/
flutter run -d chrome  # معاينة ويب
flutter build apk --release # للـ APK من Android 5 إلى 16
```
