/* =========================================================
   إعدادات الاتصال بقاعدة البيانات المشتركة (Firebase)
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyAOGhCYuEgI_aECyL-RQiMtoby58OtkJKY",
  authDomain: "real-estate-tracker-68702.firebaseapp.com",
  projectId: "real-estate-tracker-68702",
  storageBucket: "real-estate-tracker-68702.firebasestorage.app",
  messagingSenderId: "435801231266",
  appId: "1:435801231266:web:79c9d7fe03a300858cacfb",
};

/* معرّف مساحة العمل: كل من يستخدم نفس هذا المعرّف مع نفس مشروع
   Firebase سيشارك نفس بيانات المهام والفريق. غيّره فقط إذا
   أردت تشغيل أكثر من مشروع/فريق منفصل على نفس قاعدة Firebase. */
const WORKSPACE_ID = "real-estate-tracker-default";