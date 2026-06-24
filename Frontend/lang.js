/* ═══════════════════════════════════════════════════
   ExploreX — Multi-Language Module  v2.0
   Supports: English (en) · हिंदी (hi) · मराठी (mr)
   Auto-injects itself — no manual call needed.
═══════════════════════════════════════════════════ */

/* ─── TRANSLATIONS ─── */
const TRANSLATIONS = {
  en: {
    nav_explore:'Explore', nav_categories:'Categories', nav_memories:'Memories',
    nav_route:'Route', nav_kumbh:'Kumbh Guide', nav_profile:'Profile',
    nav_login:'Log In', nav_about:'About Us',
    hero_title:'Explore Places', hero_title_span:'Near You',
    hero_sub:'Discover hidden gems, iconic landmarks, and local favourites — all around your current location.',
    hero_btn:'Explore Now',
    hero_stat1:'Places Listed', hero_stat2:'Categories', hero_stat3:'Avg. Rating',
    sec_categories:'Browse by Category', sec_cat_sub:'What kind of place are you looking for?',
    sec_popular:'Popular Near You', sec_popular_sub:'Top-rated places around',
    sec_memories:'Traveller Memories', sec_mem_sub:'Recent public memories shared by travellers',
    cat_historical:'Historical', cat_nature:'Nature', cat_beaches:'Beaches',
    cat_religious:'Religious', cat_food:'Food',
    btn_view_details:'View Details', btn_add_stop:'+ Add Stop', btn_added:'✓ Added',
    filter_label:'Filter:', sort_top:'Top Rated', sort_nearest:'Nearest First',
    filter_all:'All', filter_dist_all:'All Distances',
    route_title:'Plan Your Perfect Journey',
    route_sub:'Enter your route, pick your transport, and discover places along the way',
    route_from:'Enter starting location', route_to:'Enter destination',
    route_swap:'⇅ Swap', route_transport:'Select Transport',
    route_find:'🧭 Find Route', route_save:'🔖 Save',
    route_explore:'Explore Along Your Route', recent_routes:'🕐 Recent Routes',
    kumbh_title:'Nashik Kumbh Mela Smart Guide',
    kumbh_sub:'Crowd guidance · Smart routes · Important dates · Emergency help',
    kumbh_crowd:'📍 Crowd Guidance', kumbh_dates:'📅 Important Kumbh Dates',
    kumbh_weather:'🌤️ Nashik Weather', kumbh_route:'🧭 Smart Route to Ghat',
    kumbh_facilities:'🏥 Nearby Facilities', kumbh_plan:'🗓️ Plan My Visit',
    kumbh_ai:'🤖 Smart Suggestions', kumbh_moments:'📸 Kumbh Moments',
    kumbh_sos:'🚨 SOS', kumbh_gen_plan:'✨ Generate My Plan',
    profile_title:'My Travel Memories', profile_edit:'✏️ Edit Profile',
    profile_add_mem:'📸 Add Memory',
    tab_all:'All', tab_public:'🌍 Public', tab_private:'🔒 Private',
    stat_places:'Places Visited', stat_cities:'Cities Covered',
    stat_memories:'Memories', stat_badges:'Badges Earned',
    dark_mode_label:'Dark Mode', dark_mode_sub:'Switch to dark theme',
    logout:'🚪 Log Out',
    login_title:'Welcome back 👋', login_sub:'Log in to continue your travel journey.',
    signup_title:'Join Explore 🌍', signup_sub:'Create your free account and start exploring.',
    btn_login:'Log In', btn_signup:'Create Account',
    lang_label:'Language', places_found:'places found',
  },
  hi: {
    nav_explore:'एक्सप्लोर', nav_categories:'श्रेणियाँ', nav_memories:'यादें',
    nav_route:'रूट', nav_kumbh:'कुंभ गाइड', nav_profile:'प्रोफ़ाइल',
    nav_login:'लॉग इन', nav_about:'हमारे बारे में',
    hero_title:'आसपास की जगहें', hero_title_span:'खोजें',
    hero_sub:'छुपे हुए रत्न, प्रसिद्ध स्थल और स्थानीय पसंदीदा — सब एक जगह।',
    hero_btn:'अभी खोजें',
    hero_stat1:'स्थान सूचीबद्ध', hero_stat2:'श्रेणियाँ', hero_stat3:'औसत रेटिंग',
    sec_categories:'श्रेणी के अनुसार ब्राउज़ करें', sec_cat_sub:'आप किस प्रकार की जगह ढूंढ रहे हैं?',
    sec_popular:'आपके पास लोकप्रिय', sec_popular_sub:'के आसपास शीर्ष रेटेड स्थान',
    sec_memories:'यात्री यादें', sec_mem_sub:'यात्रियों द्वारा साझा की गई हालिया यादें',
    cat_historical:'ऐतिहासिक', cat_nature:'प्रकृति', cat_beaches:'समुद्र तट',
    cat_religious:'धार्मिक', cat_food:'खाना',
    btn_view_details:'विवरण देखें', btn_add_stop:'+ पड़ाव जोड़ें', btn_added:'✓ जोड़ा गया',
    filter_label:'फ़िल्टर:', sort_top:'सर्वोच्च रेटेड', sort_nearest:'नज़दीकी पहले',
    filter_all:'सभी', filter_dist_all:'सभी दूरियाँ',
    route_title:'अपनी यात्रा योजना बनाएं',
    route_sub:'रूट दर्ज करें, यातायात चुनें और रास्ते में जगहें खोजें',
    route_from:'शुरुआती स्थान दर्ज करें', route_to:'गंतव्य दर्ज करें',
    route_swap:'⇅ बदलें', route_transport:'यातायात चुनें',
    route_find:'🧭 रूट खोजें', route_save:'🔖 सेव करें',
    route_explore:'रूट के किनारे जगहें', recent_routes:'🕐 हालिया रूट',
    kumbh_title:'नाशिक कुंभ मेला स्मार्ट गाइड',
    kumbh_sub:'भीड़ मार्गदर्शन · स्मार्ट रूट · महत्वपूर्ण तिथियाँ · आपातकालीन सहायता',
    kumbh_crowd:'📍 भीड़ मार्गदर्शन', kumbh_dates:'📅 महत्वपूर्ण कुंभ तिथियाँ',
    kumbh_weather:'🌤️ नाशिक मौसम', kumbh_route:'🧭 घाट तक स्मार्ट रूट',
    kumbh_facilities:'🏥 नज़दीकी सुविधाएं', kumbh_plan:'🗓️ अपनी यात्रा योजना',
    kumbh_ai:'🤖 स्मार्ट सुझाव', kumbh_moments:'📸 कुंभ पल',
    kumbh_sos:'🚨 आपातकाल', kumbh_gen_plan:'✨ योजना बनाएं',
    profile_title:'मेरी यात्रा यादें', profile_edit:'✏️ प्रोफ़ाइल संपादित करें',
    profile_add_mem:'📸 याद जोड़ें',
    tab_all:'सभी', tab_public:'🌍 सार्वजनिक', tab_private:'🔒 निजी',
    stat_places:'स्थान देखे', stat_cities:'शहर',
    stat_memories:'यादें', stat_badges:'बैज',
    dark_mode_label:'डार्क मोड', dark_mode_sub:'डार्क थीम पर स्विच करें',
    logout:'🚪 लॉग आउट',
    login_title:'वापस आपका स्वागत है 👋', login_sub:'अपनी यात्रा जारी रखने के लिए लॉग इन करें।',
    signup_title:'Explore से जुड़ें 🌍', signup_sub:'मुफ़्त खाता बनाएं और घूमना शुरू करें।',
    btn_login:'लॉग इन', btn_signup:'खाता बनाएं',
    lang_label:'भाषा', places_found:'जगहें मिलीं',
  },
  mr: {
    nav_explore:'एक्सप्लोर', nav_categories:'श्रेणी', nav_memories:'आठवणी',
    nav_route:'मार्ग', nav_kumbh:'कुंभ मार्गदर्शक', nav_profile:'प्रोफाइल',
    nav_login:'लॉग इन', nav_about:'आमच्याबद्दल',
    hero_title:'जवळची ठिकाणे', hero_title_span:'शोधा',
    hero_sub:'लपलेले रत्न, प्रसिद्ध ठिकाणे आणि स्थानिक आवडती जागा — सगळे एकाच ठिकाणी।',
    hero_btn:'आता शोधा',
    hero_stat1:'ठिकाणे नोंदवलेली', hero_stat2:'श्रेणी', hero_stat3:'सरासरी रेटिंग',
    sec_categories:'श्रेणीनुसार ब्राउज़ करा', sec_cat_sub:'तुम्हाला कोणत्या प्रकारची जागा हवी आहे?',
    sec_popular:'जवळील लोकप्रिय', sec_popular_sub:'च्या आसपास उत्तम रेटेड ठिकाणे',
    sec_memories:'प्रवासी आठवणी', sec_mem_sub:'प्रवाशांनी शेअर केलेल्या आठवणी',
    cat_historical:'ऐतिहासिक', cat_nature:'निसर्ग', cat_beaches:'समुद्रकिनारे',
    cat_religious:'धार्मिक', cat_food:'खाणे-पिणे',
    btn_view_details:'तपशील पाहा', btn_add_stop:'+ थांबा जोडा', btn_added:'✓ जोडले',
    filter_label:'फिल्टर:', sort_top:'सर्वोत्तम रेटेड', sort_nearest:'जवळचे आधी',
    filter_all:'सर्व', filter_dist_all:'सर्व अंतर',
    route_title:'तुमचा परिपूर्ण प्रवास नियोजित करा',
    route_sub:'मार्ग टाका, वाहन निवडा आणि वाटेत ठिकाणे शोधा',
    route_from:'सुरुवातीचे ठिकाण टाका', route_to:'गंतव्य टाका',
    route_swap:'⇅ बदला', route_transport:'वाहन निवडा',
    route_find:'🧭 मार्ग शोधा', route_save:'🔖 जतन करा',
    route_explore:'मार्गावरील ठिकाणे', recent_routes:'🕐 अलीकडील मार्ग',
    kumbh_title:'नाशिक कुंभमेळा स्मार्ट मार्गदर्शक',
    kumbh_sub:'गर्दी मार्गदर्शन · स्मार्ट मार्ग · महत्त्वाच्या तारखा · आपत्कालीन मदत',
    kumbh_crowd:'📍 गर्दी मार्गदर्शन', kumbh_dates:'📅 महत्त्वाच्या कुंभ तारखा',
    kumbh_weather:'🌤️ नाशिक हवामान', kumbh_route:'🧭 घाटापर्यंत स्मार्ट मार्ग',
    kumbh_facilities:'🏥 जवळील सुविधा', kumbh_plan:'🗓️ माझी भेट नियोजित करा',
    kumbh_ai:'🤖 स्मार्ट सूचना', kumbh_moments:'📸 कुंभ क्षण',
    kumbh_sos:'🚨 आपत्काल', kumbh_gen_plan:'✨ योजना तयार करा',
    profile_title:'माझ्या प्रवासाच्या आठवणी', profile_edit:'✏️ प्रोफाइल संपादित करा',
    profile_add_mem:'📸 आठवण जोडा',
    tab_all:'सर्व', tab_public:'🌍 सार्वजनिक', tab_private:'🔒 खाजगी',
    stat_places:'ठिकाणे पाहिली', stat_cities:'शहरे',
    stat_memories:'आठवणी', stat_badges:'बॅजेस',
    dark_mode_label:'डार्क मोड', dark_mode_sub:'डार्क थीमवर जा',
    logout:'🚪 लॉग आउट',
    login_title:'परत स्वागत आहे 👋', login_sub:'तुमचा प्रवास सुरू ठेवण्यासाठी लॉग इन करा।',
    signup_title:'Explore मध्ये सामील व्हा 🌍', signup_sub:'मोफत खाते तयार करा आणि फिरायला सुरुवात करा।',
    btn_login:'लॉग इन', btn_signup:'खाते तयार करा',
    lang_label:'भाषा', places_found:'ठिकाणे सापडली',
  }
};

/* ─── STATE ─── */
let currentLang = 'en';

/* ─── GET TRANSLATION ─── */
function t(key) {
  return (TRANSLATIONS[currentLang] || TRANSLATIONS.en)[key] || key;
}

/* ─── APPLY TRANSLATIONS ─── */
function applyLanguage(lang) {
  if (!TRANSLATIONS[lang]) return;
  currentLang = lang;
  const tr = TRANSLATIONS[lang];

  document.querySelectorAll('[data-key]').forEach(el => {
    const key = el.getAttribute('data-key');
    if (tr[key] === undefined) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = tr[key];
    } else {
      el.innerHTML = tr[key];
    }
  });

  document.querySelectorAll('[data-key-placeholder]').forEach(el => {
    const key = el.getAttribute('data-key-placeholder');
    if (tr[key] !== undefined) el.placeholder = tr[key];
  });

  document.documentElement.lang = lang;

  if (lang === 'hi' || lang === 'mr') {
    document.body.style.fontFamily = "'Noto Sans Devanagari', 'DM Sans', sans-serif";
  } else {
    document.body.style.fontFamily = "'DM Sans', sans-serif";
  }

  // Update active state on all lang option buttons
  document.querySelectorAll('.lang-option').forEach(btn => {
    const code = btn.getAttribute('data-lang-code');
    btn.classList.toggle('active', code === lang);
    const check = btn.querySelector('.check');
    if (check) check.style.display = code === lang ? '' : 'none';
  });

  document.dispatchEvent(new CustomEvent('langChanged', { detail: { lang, tr } }));
}

/* ─── SWITCH LANGUAGE ─── */
function switchLanguage(lang) {
  localStorage.setItem('explore_lang', lang);
  applyLanguage(lang);
  closeLangDropdowns();
  if (typeof showToast === 'function') {
    const labels = { en:'🌐 English', hi:'🌐 हिंदी', mr:'🌐 मराठी' };
    showToast(labels[lang] || lang);
  }
}

/* ─── INIT LANGUAGE (read from localStorage or browser) ─── */
function initLanguage() {
  const saved = localStorage.getItem('explore_lang');
  if (saved && TRANSLATIONS[saved]) {
    currentLang = saved;
  } else {
    const bl = (navigator.language || 'en').toLowerCase();
    if (bl.startsWith('mr')) currentLang = 'mr';
    else if (bl.startsWith('hi')) currentLang = 'hi';
    else currentLang = 'en';
  }
  applyLanguage(currentLang);
}

/* ─── INJECT CSS (once per page) ─── */
function injectLangCSS() {
  if (document.getElementById('lang-css')) return;
  const style = document.createElement('style');
  style.id = 'lang-css';
  style.textContent = `
    .lang-wrap { position: relative; flex-shrink: 0; display: inline-flex; }
    .lang-trigger {
      display: flex; align-items: center; gap: 5px;
      padding: 6px 12px; border-radius: 50px; cursor: pointer;
      border: 1.5px solid var(--border, var(--bd, #E2E8F0));
      background: var(--card, #fff);
      font-size: 13px; font-weight: 600;
      color: var(--text-mid, var(--tm, #475569));
      font-family: 'DM Sans', sans-serif;
      white-space: nowrap; transition: all .18s;
      outline: none;
    }
    .lang-trigger:hover {
      border-color: var(--primary, var(--p, #1A3CD8));
      color: var(--primary, var(--p, #1A3CD8));
      background: var(--primary-light, var(--pl, #EEF1FD));
    }
    .lang-trigger .lg-globe { font-size: 15px; line-height: 1; }
    .lang-trigger .lg-text  { font-size: 13px; }
    .lang-trigger .lg-arrow { font-size: 9px; opacity: .6; transition: transform .2s; }
    .lang-wrap.open .lang-trigger .lg-arrow { transform: rotate(180deg); }
    .lang-dropdown {
      position: absolute; top: calc(100% + 6px); right: 0;
      background: var(--card, #fff);
      border: 1px solid var(--border, var(--bd, #E2E8F0));
      border-radius: 14px;
      box-shadow: 0 10px 36px rgba(0,0,0,.14);
      min-width: 170px; z-index: 9999;
      overflow: hidden; display: none;
      animation: ldDrop .16s ease;
    }
    @keyframes ldDrop { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
    .lang-wrap.open .lang-dropdown { display: block; }
    .lang-option {
      display: flex; align-items: center; gap: 10px;
      padding: 11px 16px; width: 100%;
      font-size: 14px; font-weight: 500;
      color: var(--text-mid, var(--tm, #475569));
      background: transparent; border: none; text-align: left; cursor: pointer;
      font-family: 'DM Sans', 'Noto Sans Devanagari', sans-serif;
      transition: background .15s, color .15s;
    }
    .lang-option:hover { background: var(--bg, #F5F7FF); color: var(--text, var(--t, #0F172A)); }
    .lang-option.active {
      background: var(--primary-light, var(--pl, #EEF1FD));
      color: var(--primary, var(--p, #1A3CD8)); font-weight: 700;
    }
    .lang-option .flag { font-size: 17px; flex-shrink: 0; }
    .lang-option .name { flex: 1; }
    .lang-option .check { font-size: 13px; margin-left: auto; }
    body.dark-mode .lang-trigger {
      background: var(--card, #1E293B);
      border-color: var(--bd, #334155);
      color: var(--tm, #CBD5E1);
    }
    body.dark-mode .lang-trigger:hover {
      background: var(--pl, #1E3A5F);
      border-color: #3B82F6;
      color: #93C5FD;
    }
    body.dark-mode .lang-dropdown {
      background: var(--card, #1E293B);
      border-color: var(--bd, #334155);
      box-shadow: 0 10px 36px rgba(0,0,0,.5);
    }
    body.dark-mode .lang-option:hover { background: #334155; color: #F1F5F9; }
    body.dark-mode .lang-option.active { background: #1E3A5F; color: #93C5FD; }
    @media (max-width: 640px) {
      .lang-trigger .lg-text { display: none; }
      .lang-trigger { padding: 6px 9px; }
    }
  `;
  document.head.appendChild(style);

  // Load Devanagari font
  if (!document.getElementById('noto-font')) {
    const link = document.createElement('link');
    link.id = 'noto-font'; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }
}

/* ─── INJECT SELECTOR INTO SLOT ─── */
function injectLangSelector(slotId) {
  const slot = document.getElementById(slotId);
  if (!slot || slot.querySelector('.lang-wrap')) return; // Already injected

  injectLangCSS();

  const wrapId = 'lang-wrap-' + slotId;
  const OPTS = [
    { code: 'en', flag: '🇬🇧', name: 'English'  },
    { code: 'hi', flag: '🇮🇳', name: 'हिंदी'     },
    { code: 'mr', flag: '🏮',  name: 'मराठी'     },
  ];

  slot.innerHTML = `
    <div class="lang-wrap" id="${wrapId}">
      <button class="lang-trigger"
        onclick="document.getElementById('${wrapId}').classList.toggle('open');event.stopPropagation();"
        aria-label="Select language">
        <span class="lg-globe">🌐</span>
        <span class="lg-text" data-key="lang_label">Language</span>
        <span class="lg-arrow">▾</span>
      </button>
      <div class="lang-dropdown">
        ${OPTS.map(o => `
          <button class="lang-option ${currentLang === o.code ? 'active' : ''}"
            data-lang-code="${o.code}"
            onclick="switchLanguage('${o.code}');event.stopPropagation();">
            <span class="flag">${o.flag}</span>
            <span class="name">${o.name}</span>
            <span class="check" style="${currentLang === o.code ? '' : 'display:none'}">✓</span>
          </button>`).join('')}
      </div>
    </div>`;

  // Close on outside click
  if (!window._ldClickBound) {
    window._ldClickBound = true;
    document.addEventListener('click', () => closeLangDropdowns());
  }
}

function closeLangDropdowns() {
  document.querySelectorAll('.lang-wrap.open').forEach(w => w.classList.remove('open'));
}

/* ─── AUTO-INIT on DOMContentLoaded ─── */
document.addEventListener('DOMContentLoaded', () => {
  injectLangCSS();
  initLanguage(); // sets currentLang from localStorage

  // Auto-inject into any slot found in DOM
  document.querySelectorAll('[id="lang-selector-slot"]').forEach(slot => {
    injectLangSelector(slot.id);
  });
});

