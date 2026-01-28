/* Dünya Saatı — HTML/CSS/JS (Nominatim + Open‑Meteo) */

// DOM
const cityInput = document.getElementById('cityInput');
const suggestionsList = document.getElementById('suggestions');
const clockContainer = document.getElementById('digitalClock');
const cityNameDisplay = document.getElementById('cityName');
const countryNameDisplay = document.getElementById('countryName');
const clockBackground = document.getElementById('clockBackground');
const clockBackgroundB = document.getElementById('clockBackgroundB');
const favoriteBtn = document.getElementById('favoriteBtn');
const infoContent = document.getElementById('infoContent');
const localTimeDisplay = document.getElementById('localTime');
const localTimeZone = document.getElementById('localTimeZone');
const favoritesList = document.getElementById('favoritesList');
const errorMessage = document.getElementById('errorMessage');
const handHour = document.getElementById('handHour');
const handMinute = document.getElementById('handMinute');
const handSecond = document.getElementById('handSecond');

// State
let currentPlace = null; // { key, city, admin, country, lat, lon, tz }
let favorites = [];
let cityTimeInterval = null;
let lastSuggestions = [];
const imageCache = new Map(); // key -> url

const STORAGE_KEY_FAVS = 'worldClock.favorites.v1';
const STORAGE_KEY_LAST = 'worldClock.lastPlace.v1';
let bgToggle = 0; // 0 -> A active, 1 -> B active

window.addEventListener('load', () => {
    loadFavorites();
    displayFavorites();

    updateLocalTime();
    setInterval(updateLocalTime, 1000);
    updateBackgroundMode();
    setInterval(updateBackgroundMode, 60000);

    // Son seçimi aç, yoxdursa Bakı
    const last = loadLastPlace();
    if (last) {
        usePlace(last, { persist: false, fromFavorites: true });
    } else {
        selectByQuery('Bakı');
    }

    // default bg layer visibility
    if (clockBackground) clockBackground.classList.add('is-active', 'kenburns');
});

function updateLocalTime() {
    const now = new Date();
    localTimeDisplay.textContent = formatClockHHMMSS(now, Intl.DateTimeFormat().resolvedOptions().timeZone);

    const tzName =
        Intl.DateTimeFormat('az-AZ', { timeZoneName: 'long' })
            .formatToParts(now)
            .find((p) => p.type === 'timeZoneName')?.value || '';

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Lokal';
    localTimeZone.textContent = tzName ? `${tz} (${tzName})` : tz;
}

function updateBackgroundMode() {
    const hour = new Date().getHours();
    const body = document.body;
    if (hour >= 18 || hour < 6) {
        body.classList.remove('day-mode');
        body.classList.add('night-mode');
    } else {
        body.classList.remove('night-mode');
        body.classList.add('day-mode');
    }
}

function debounce(fn, delayMs) {
    let t = null;
    return (...args) => {
        if (t) clearTimeout(t);
        t = setTimeout(() => fn(...args), delayMs);
    };
}

const onInputDebounced = debounce(async () => {
    const q = cityInput.value.trim();
    if (!q) {
        setSuggestions([]);
        hideError();
        return;
    }
    await searchAndSuggest(q);
}, 350);

cityInput.addEventListener('input', onInputDebounced);

cityInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const q = cityInput.value.trim();
        if (!q) return;
        if (lastSuggestions.length > 0) {
            selectSuggestion(lastSuggestions[0]);
        } else {
            selectByQuery(q);
        }
    }
    if (e.key === 'Escape') {
        setSuggestions([]);
    }
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) {
        setSuggestions([]);
    }
});

async function searchAndSuggest(query) {
    hideError();

    try {
        // AZ prioritet: (ə,ğ,ı,ö,ü,ç,ş) varsa və ya bilinən AZ şəhər adıdır
        const preferAZ = shouldPreferAzerbaijan(query);

        // 1) AZ (lazımdırsa) -> 2) Global fallback
        const results =
            preferAZ ? await geocodeNominatim(query, { countrycodes: 'az' }) : [];

        const merged = mergeAndDedupe(
            results,
            await geocodeNominatim(query, { countrycodes: '' })
        );

        lastSuggestions = merged.slice(0, 8);
        setSuggestions(lastSuggestions);

        if (lastSuggestions.length === 0) {
            showError('Məkan tapılmadı. Zəhmət olmasa daha dəqiq yazın (məs: “Gədəbəy, Azərbaycan”).');
        }
    } catch (err) {
        console.log('Axtarış xətası:', err);
        setSuggestions([]);
        showError('Axtarış zamanı xəta baş verdi. İnterneti yoxlayın və yenidən cəhd edin.');
    }
}

function setSuggestions(items) {
    suggestionsList.innerHTML = '';
    if (!items || items.length === 0) {
        suggestionsList.classList.remove('active');
        return;
    }
    items.forEach((item) => {
        const el = document.createElement('div');
        el.className = 'suggestion-item';
        el.textContent = item.label;
        el.addEventListener('click', () => selectSuggestion(item));
        suggestionsList.appendChild(el);
    });
    suggestionsList.classList.add('active');
}

function selectSuggestion(s) {
    setSuggestions([]);
    cityInput.blur();
    selectByPlace(s);
}

async function selectByQuery(query) {
    hideError();
    setSuggestions([]);

    try {
        const preferAZ = shouldPreferAzerbaijan(query);
        const az = preferAZ ? await geocodeNominatim(query, { countrycodes: 'az', limit: 5 }) : [];
        const global = await geocodeNominatim(query, { countrycodes: '', limit: 5 });
        const merged = mergeAndDedupe(az, global);

        if (merged.length === 0) {
            showError('Şəhər tapılmadı. Daha dəqiq yazın (məs: “Gədəbəy, Azərbaycan”).');
            return;
        }

        // Birdən çox nəticə varsa: dropdown-da saxla ki istifadəçi seçsin
        if (merged.length > 1) {
            lastSuggestions = merged.slice(0, 8);
            setSuggestions(lastSuggestions);
            suggestionsList.scrollIntoView({ block: 'nearest' });
            return;
        }

        await selectByPlace(merged[0]);
    } catch (err) {
        console.log('Şəhər seçimi xətası:', err);
        showError('Şəhər seçimi zamanı xəta baş verdi.');
    }
}

async function selectByPlace(place) {
    hideError();
    const tz = await getTimezoneForCoords(place.lat, place.lon);
    if (!tz) {
        showError('Vaxt qurşağı tapılmadı. Yenidən cəhd edin.');
        return;
    }
    const normalized = {
        ...place,
        tz,
    };
    usePlace(normalized, { persist: true, fromFavorites: false });
}

function usePlace(place, { persist, fromFavorites }) {
    currentPlace = place;
    cityInput.value = place.label;

    cityNameDisplay.textContent = place.city || place.label;
    countryNameDisplay.textContent = place.country ? `${place.country}${place.admin ? ` • ${place.admin}` : ''}` : (place.admin || '');

    favoriteBtn.style.display = 'block';
    updateFavoriteBtnState();

    // background image (Wikipedia/Wikimedia -> Unsplash fallback)
    setBackgroundForPlace(place).catch((err) => {
        console.log('Şəkil yüklənmədi:', err);
        // Qeyd: file:// ilə açanda browser fetch-i bloklaya bilər
        showError('Şəkil yüklənmədi. Saytı local server ilə açın (məs: python -m http.server 5500).');
        setBackgroundWithCrossfade(null);
    });

    // interval
    if (cityTimeInterval) clearInterval(cityTimeInterval);
    updateCityTimeAndAnalog();
    displayCityInfo();
    cityTimeInterval = setInterval(() => {
        updateCityTimeAndAnalog();
        // info-dakı tarix/offset dinamik qalsın
        displayCityInfo();
    }, 1000);

    if (persist) saveLastPlace(place);
    if (fromFavorites) hideError();
}

function updateCityTimeAndAnalog() {
    if (!currentPlace?.tz) return;
    const now = new Date();
    const tz = currentPlace.tz;

    // Digital
    clockContainer.textContent = formatClockHHMMSS(now, tz);

    // Analog
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(now);

    const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    const s = Number(parts.find((p) => p.type === 'second')?.value || 0);

    const hourDeg = ((h % 12) + m / 60 + s / 3600) * 30;
    const minuteDeg = (m + s / 60) * 6;
    const secondDeg = s * 6;

    handHour.style.transform = `translate(-50%, -100%) rotate(${hourDeg}deg)`;
    handMinute.style.transform = `translate(-50%, -100%) rotate(${minuteDeg}deg)`;
    handSecond.style.transform = `translate(-50%, -100%) rotate(${secondDeg}deg)`;
}

function displayCityInfo() {
    if (!currentPlace?.tz) return;

    const now = new Date();
    const tz = currentPlace.tz;

    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localOffsetMin = -now.getTimezoneOffset(); // minutes east of UTC
    const cityOffsetMin = getOffsetMinutesForTimezone(tz, now);
    const diffMin = cityOffsetMin - localOffsetMin;

    const diffText = formatOffsetDiffText(diffMin);
    const dateText = new Intl.DateTimeFormat('az-AZ', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'long',
    }).format(now);

    const coordsText = `${Number(currentPlace.lat).toFixed(5)}, ${Number(currentPlace.lon).toFixed(5)}`;

    infoContent.innerHTML = `
        <div class="info-item">
            <div class="info-item-label">Ölkə / Region</div>
            <div class="info-item-value">${escapeHtml([currentPlace.country, currentPlace.admin].filter(Boolean).join(' • ') || '—')}</div>
        </div>
        <div class="info-item">
            <div class="info-item-label">Vaxt Qurşağı</div>
            <div class="info-item-value">${escapeHtml(tz)}</div>
        </div>
        <div class="info-item">
            <div class="info-item-label">Vaxt Fərqi (cihazınızla)</div>
            <div class="info-item-value">${escapeHtml(diffText)}</div>
        </div>
        <div class="info-item">
            <div class="info-item-label">Tarix</div>
            <div class="info-item-value">${escapeHtml(dateText)}</div>
        </div>
        <div class="info-item">
            <div class="info-item-label">Koordinatlar</div>
            <div class="info-item-value">${escapeHtml(coordsText)}</div>
        </div>
        <div class="info-item">
            <div class="info-item-label">Lokal Vaxt Qurşağı</div>
            <div class="info-item-value">${escapeHtml(localTz || 'Lokal')}</div>
        </div>
    `;
}

// Favorites
favoriteBtn.addEventListener('click', () => {
    if (!currentPlace) return;
    const idx = favorites.findIndex((f) => f.key === currentPlace.key);
    if (idx >= 0) {
        favorites.splice(idx, 1);
    } else {
        favorites.unshift({ ...currentPlace });
    }
    favorites = favorites.slice(0, 30);
    saveFavorites();
    displayFavorites();
    updateFavoriteBtnState();
});

function updateFavoriteBtnState() {
    if (!currentPlace) return;
    const isFav = favorites.some((f) => f.key === currentPlace.key);
    if (isFav) {
        favoriteBtn.classList.add('active');
        favoriteBtn.textContent = '♥';
    } else {
        favoriteBtn.classList.remove('active');
        favoriteBtn.textContent = '♡';
    }
}

function displayFavorites() {
    if (!favorites || favorites.length === 0) {
        favoritesList.innerHTML = '<p style="color: rgba(255,255,255,0.6);">Hələ sevdikləriniz yoxdur</p>';
        return;
    }

    favoritesList.innerHTML = '';
    favorites.forEach((fav) => {
        const item = document.createElement('div');
        item.className = 'favorite-item';

        const label = document.createElement('span');
        label.textContent = fav.city ? `${fav.city}${fav.country ? `, ${fav.country}` : ''}` : fav.label;
        label.addEventListener('click', () => usePlace(fav, { persist: true, fromFavorites: true }));

        const remove = document.createElement('span');
        remove.className = 'remove-btn';
        remove.title = 'Sil';
        remove.textContent = '✕';
        remove.addEventListener('click', (e) => {
            e.stopPropagation();
            favorites = favorites.filter((f) => f.key !== fav.key);
            saveFavorites();
            displayFavorites();
            updateFavoriteBtnState();
        });

        item.appendChild(label);
        item.appendChild(remove);
        favoritesList.appendChild(item);
    });
}

function saveFavorites() {
    localStorage.setItem(STORAGE_KEY_FAVS, JSON.stringify(favorites));
}

function loadFavorites() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_FAVS);
        favorites = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(favorites)) favorites = [];
    } catch {
        favorites = [];
    }
}

function saveLastPlace(place) {
    try {
        localStorage.setItem(STORAGE_KEY_LAST, JSON.stringify(place));
    } catch {
        // ignore
    }
}

function loadLastPlace() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_LAST);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

// API helpers
async function geocodeNominatim(query, { countrycodes, limit = 8 }) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', query);
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('namedetails', '1');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('accept-language', 'az,en');
    url.searchParams.set('dedupe', '1');
    url.searchParams.set('extratags', '1');
    if (countrycodes) url.searchParams.set('countrycodes', countrycodes);

    const res = await fetch(url.toString(), {
        headers: {
            'Accept': 'application/json',
            'Accept-Language': 'az,en;q=0.8',
        },
    });
    if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
        .map((p) => mapNominatimPlace(p))
        .filter(Boolean);
}

function mapNominatimPlace(p) {
    const lat = Number(p.lat);
    const lon = Number(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const addr = p.address || {};
    const city =
        addr.city ||
        addr.town ||
        addr.village ||
        addr.municipality ||
        addr.county ||
        (p.namedetails && (p.namedetails.name || p.namedetails['name:az'])) ||
        p.name ||
        '';

    const admin =
        addr.state ||
        addr.region ||
        addr.county ||
        addr.province ||
        '';

    const country = addr.country || '';

    const key = String(p.place_id || `${lat.toFixed(5)},${lon.toFixed(5)}:${country}:${city}`);

    const label = buildLabel({ city, admin, country }, p.display_name);

    return {
        key,
        city: city || label,
        admin,
        country,
        lat,
        lon,
        label,
    };
}

function buildLabel({ city, admin, country }, displayNameFallback) {
    const parts = [];
    if (city) parts.push(city);
    if (admin && admin !== city) parts.push(admin);
    if (country && country !== admin) parts.push(country);
    const out = parts.filter(Boolean).join(', ').trim();
    return out || (displayNameFallback ? String(displayNameFallback) : 'Məkan');
}

function mergeAndDedupe(primary, secondary) {
    const map = new Map();
    [...primary, ...secondary].forEach((p) => {
        if (!p) return;
        if (!map.has(p.key)) map.set(p.key, p);
    });
    return Array.from(map.values());
}

async function getTimezoneForCoords(lat, lon) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('current', 'temperature_2m');

    const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`Open‑Meteo error: ${res.status}`);
    const data = await res.json();
    return data?.timezone || null;
}

function formatClockHHMMSS(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(date);
    const h = parts.find((p) => p.type === 'hour')?.value || '00';
    const m = parts.find((p) => p.type === 'minute')?.value || '00';
    const s = parts.find((p) => p.type === 'second')?.value || '00';
    return `${h}:${m}:${s}`;
}

function getOffsetMinutesForTimezone(timeZone, date) {
    // Intl shortOffset: "GMT+4" / "GMT+04:00" kimi çıxır
    const tzPart = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset',
    }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value;

    if (!tzPart) return 0;
    const m = tzPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    const hh = Number(m[2] || 0);
    const mm = Number(m[3] || 0);
    return sign * (hh * 60 + mm);
}

function formatOffsetDiffText(diffMin) {
    if (diffMin === 0) return 'Eyni vaxt';
    const abs = Math.abs(diffMin);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    const hm = m ? `${h} saat ${m} dəqiqə` : `${h} saat`;
    return diffMin > 0 ? `Sizdən ${hm} irəlidə` : `Sizdən ${hm} geridə`;
}

async function setBackgroundForPlace(place) {
    const key = place.key || place.label;
    if (imageCache.has(key)) {
        setBackgroundWithCrossfade(imageCache.get(key));
        return;
    }

    const city = String(place.city || '').trim();
    const country = String(place.country || '').trim();
    const query = [city, country].filter(Boolean).join(', ');

    const url = await fetchBestImageUrl(query, city || place.label);
    imageCache.set(key, url);
    setBackgroundWithCrossfade(url);
}

function setBackgroundWithCrossfade(url) {
    const a = clockBackground;
    const b = clockBackgroundB;
    if (!a || !b) return;

    if (!url) {
        // şəkil yoxdursa, ən azından default gradient görünsün
        a.style.backgroundImage = '';
        b.style.backgroundImage = '';
        a.classList.add('is-active');
        b.classList.remove('is-active');
        return;
    }

    const nextEl = bgToggle === 0 ? b : a;
    const prevEl = bgToggle === 0 ? a : b;

    // prepare next layer
    nextEl.classList.remove('kenburns');
    nextEl.style.backgroundImage = `url('${url}')`;

    // force reflow so opacity transition triggers reliably
    // eslint-disable-next-line no-unused-expressions
    nextEl.offsetHeight;

    nextEl.classList.add('is-active');
    prevEl.classList.remove('is-active');

    // subtle ken-burns zoom on active layer
    requestAnimationFrame(() => {
        nextEl.classList.add('kenburns');
    });

    bgToggle = bgToggle === 0 ? 1 : 0;
}

async function fetchBestImageUrl(primaryQuery, fallbackQuery) {
    // 1) Wikipedia search -> summary thumbnail (açar tələb etmir, origin=* CORS üçün)
    const wikiUrl = await tryWikipediaImage(primaryQuery) || await tryWikipediaImage(fallbackQuery);
    if (wikiUrl) return wikiUrl;

    // 2) Unsplash “source” fallback (açar tələb etmir)
    const q = String(primaryQuery || fallbackQuery || '').trim() || 'city';
    // Daha çox uzaqdan görünüş üçün açar sözlər əlavə edirik
    const enriched = `${q} skyline cityscape panorama historic`;
    return `https://source.unsplash.com/1600x900/?${encodeURIComponent(enriched)}`;
}

async function tryWikipediaImage(query) {
    const q = String(query || '').trim();
    if (!q) return null;

    // Search for best matching page title
    const searchUrl = new URL('https://en.wikipedia.org/w/api.php');
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('list', 'search');
    searchUrl.searchParams.set('srsearch', q);
    searchUrl.searchParams.set('srlimit', '1');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('origin', '*');

    const sRes = await fetch(searchUrl.toString(), { headers: { 'Accept': 'application/json' } });
    if (!sRes.ok) return null;
    const sData = await sRes.json();
    const title = sData?.query?.search?.[0]?.title;
    if (!title) return null;

    // Şəkil seçimi: MediaWiki Action API ilə stabildir (REST page/media 404 verə bilir)
    const best = await getBestWikiImageForTitle(title);
    return best;
}

async function getBestWikiImageForTitle(title) {
    // 1) Səhifədə istifadə olunan şəkillərin siyahısı
    const listUrl = new URL('https://en.wikipedia.org/w/api.php');
    listUrl.searchParams.set('action', 'query');
    listUrl.searchParams.set('titles', title);
    listUrl.searchParams.set('prop', 'images');
    listUrl.searchParams.set('imlimit', '50');
    listUrl.searchParams.set('format', 'json');
    listUrl.searchParams.set('origin', '*');

    const lRes = await fetch(listUrl.toString(), { headers: { 'Accept': 'application/json' } });
    if (!lRes.ok) return null;
    const lData = await lRes.json();
    const pages = lData?.query?.pages ? Object.values(lData.query.pages) : [];
    const page = pages[0];
    const images = page?.images || [];

    // Filtrlə: yalnız foto tipli fayllar
    const fileTitles = images
        .map((x) => x?.title)
        .filter((t) => typeof t === 'string' && t.startsWith('File:'))
        .filter((t) => /\.(jpe?g|png|webp)\b/i.test(t)) // SVG çıxır
        .filter((t) => !/flag|coat of arms|seal|logo|map|locator|location|emblem/i.test(t))
        .slice(0, 40);

    if (fileTitles.length === 0) return null;

    // 2) Şəkil URL + metadata (extmetadata) al
    const infoUrl = new URL('https://en.wikipedia.org/w/api.php');
    infoUrl.searchParams.set('action', 'query');
    infoUrl.searchParams.set('titles', fileTitles.join('|'));
    infoUrl.searchParams.set('prop', 'imageinfo');
    infoUrl.searchParams.set('iiprop', 'url|size|extmetadata');
    infoUrl.searchParams.set('iiurlwidth', '1600');
    infoUrl.searchParams.set('format', 'json');
    infoUrl.searchParams.set('origin', '*');

    const iRes = await fetch(infoUrl.toString(), { headers: { 'Accept': 'application/json' } });
    if (!iRes.ok) return null;
    const iData = await iRes.json();
    const filePages = iData?.query?.pages ? Object.values(iData.query.pages) : [];

    const candidates = filePages
        .map((p) => {
            const fileTitle = p?.title || '';
            const ii = p?.imageinfo?.[0];
            if (!ii) return null;
            const url = ii?.thumburl || ii?.url || null;
            const width = ii?.thumbwidth || ii?.width || 0;
            const height = ii?.thumbheight || ii?.thumbheight || ii?.height || 0;
            const meta = ii?.extmetadata || {};
            const desc = stripHtml(meta?.ImageDescription?.value || '');
            const categories = stripHtml(meta?.Categories?.value || '');
            const keywords = stripHtml(meta?.Keywords?.value || '');
            if (!url) return null;
            return { fileTitle, url, width, height, desc, categories, keywords };
        })
        .filter(Boolean);

    if (candidates.length === 0) return null;

    // 3) Scoring: şəhər uzaqdan görünüşü / landmark / historic; flag/map/logo və s. kəs
    let best = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
        const score = scoreWikiCandidate(c);
        if (score > bestScore) {
            bestScore = score;
            best = c;
        }
    }

    // Çox zəifdirsə, wiki-dan vaz keçək (fallback Unsplash)
    if (!best || bestScore < 8) return null;
    return best.url;
}

function scoreWikiCandidate({ fileTitle, width, height, desc, categories, keywords }) {
    const text = `${fileTitle} ${desc} ${categories} ${keywords}`.toLowerCase();

    const hardBad = [
        'flag', 'coat of arms', 'seal', 'emblem', 'logo',
        'map', 'locator', 'location map', 'relief map',
        'diagram', 'chart', 'icon',
        'stamp', 'signature',
    ];
    for (const w of hardBad) if (text.includes(w)) return -100;

    let score = 0;
    const good = [
        'skyline', 'cityscape', 'panorama', 'aerial', 'overview', 'view',
        'downtown', 'old town', 'historic', 'heritage', 'architecture',
        'landmark', 'waterfront', 'harbour', 'harbor', 'river',
        'night', 'sunset',
        'fortress', 'castle', 'palace', 'mosque', 'cathedral', 'bridge', 'tower',
    ];
    for (const w of good) if (text.includes(w)) score += 5;

    const badSoft = [
        'portrait', 'person', 'people', 'political', 'party', 'election',
        'sports', 'team', 'player',
    ];
    for (const w of badSoft) if (text.includes(w)) score -= 4;

    // landşaft üstün
    if (width && height) {
        const ratio = width / height;
        if (ratio >= 1.35) score += 8;
        else if (ratio >= 1.15) score += 4;
        else if (ratio < 1) score -= 6;
        if (Math.max(width, height) >= 1200) score += 2;
    }

    // Description/keywords varsa bonus
    if (String(desc || '').trim()) score += 2;
    if (String(keywords || '').trim()) score += 1;

    return score;
}

function stripHtml(s) {
    return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function shouldPreferAzerbaijan(input) {
    const raw = String(input || '').trim().toLowerCase();
    if (!raw) return false;
    const hasAzChars = /[əğıöüşç]/i.test(raw);
    if (hasAzChars) return true;
    const n = normalizeAz(raw);
    const azCities = new Set([
        'baki', 'baku',
        'gence', 'ganja',
        'sumqayit', 'sumgait',
        'naxcivan', 'nakhchivan',
        'lenkeran', 'lankaran',
        'seki', 'shaki',
        'quba', 'quba',
        'qusar', 'qusar',
        'gebele', 'gabala',
        'goycay', 'goychay',
        'tovuz', 'tovuz',
        'samaxi', 'shamakhi',
        'susa', 'shusha',
        'goranboy', 'goranboy',
        'gedebey', 'gadabay',
        'sheki', 'shaki',
        'xirdalan', 'khirdalan',
    ]);
    return azCities.has(n);
}

function normalizeAz(s) {
    return String(s)
        .toLowerCase()
        .replace(/ə/g, 'e')
        .replace(/ı/g, 'i')
        .replace(/ö/g, 'o')
        .replace(/ü/g, 'u')
        .replace(/ç/g, 'c')
        .replace(/ş/g, 's')
        .replace(/ğ/g, 'g')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}

function hideError() {
    errorMessage.style.display = 'none';
}
