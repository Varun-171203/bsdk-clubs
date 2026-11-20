# BSDK Clubs — Android Studio & APK Build Guide

Isi folder (`E:\BSDK club`) mein ab **Desktop Website** aur **Android Studio APK Project** dono ek hi backend + frontend codebase se connected hain!

## Folder Locations
- **Android Studio Project:** `E:\BSDK club\frontend\android`
- **Shared Frontend (Web + APK):** `E:\BSDK club\frontend`
- **Shared Backend (REST + WebSocket + DB):** `E:\BSDK club\backend`

---

## Step 1: Backend Server Start Karo (Desktop + APK dono ke liye)
Terminal mein `E:\BSDK club` ke andar chalao:
```powershell
npm start
```
Startup par ye dono URLs print karega:
- **Desktop Web:** `http://localhost:4000`
- **Phone / APK (same Wi-Fi):** `http://<APNA-PC-IP>:4000` (jaise `http://10.103.158.228:4000`)

> **Tip (Windows Firewall):** Agar phone Wi-Fi par connect na ho, to Windows Defender Firewall mein TCP port `4000` allow kar do (ya Node.js ko Private Network access allow karo).

---

## Step 2: Android Studio Mein Open Karke APK Banao
1. **Android Studio** open karo.
2. **File → Open** par click karo aur ye folder select karo:
   ```text
   E:\BSDK club\frontend\android
   ```
   *(Ya terminal se direct kholne ke liye chalao: `npm run android:open`)*
3. Gradle sync finish hone do (first time 1–2 min lag sakte hain).
4. **APK generate karne ke liye:**
   - Top menu mein jao: **Build → Build Bundle(s) / APK(s) → Build APK(s)**
   - Build complete hote hi **"locate"** notification par click karo.
   - Tumhara installable APK yahan milega:
     `E:\BSDK club\frontend\android\app\build\outputs\apk\debug\app-debug.apk`
5. Is `.apk` ko apne Android phone mein copy karke install karo (ya USB cable lagakar Android Studio se direct **Run ▶** dabao).

---

## Step 3: APK Ko Backend Se Connect Karna (No Rebuild Needed!)
- Installed APK open karne par Login screen ke neeche **Backend Server URL (Android APK)** box dikhega:
  - **Same Wi-Fi par PC backend use karne ke liye:** `http://<APNA-PC-IP>:4000` (default set hai `http://10.103.158.228:4000`)
  - **Android Studio Emulator ke liye:** `http://10.0.2.2:4000`
  - **Cloud par deploy karne ke baad (Render / Railway / VPS):** apna live URL daalo (jaise `https://api.bsdkclubs.app`) aur **Save** dabao!

---

## Step 4: Future Mein UI Change Karo To APK Update Kaise Karna Hai
Jab bhi frontend code mein koi change karo, bas ek command chalao:
```powershell
npm run android:sync
```
Ye React app ko rebuild karke automatically `frontend/android` mein copy kar dega — phir Android Studio se naya APK build kar lo!
