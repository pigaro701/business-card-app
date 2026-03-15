// ── Supabase 초기화 ──────────────────────────────────────────────────────────
const db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// ── 상태 ─────────────────────────────────────────────────────────────────────
let currentCard = null;
let gpsData = { lat: null, lng: null };
let cameraStream = null;
let tesseractLoaded = false;
let lastCapturedBlob = null;   // 사진 저장용 Blob
let previewObjectURL  = null;  // 미리보기 ObjectURL (메모리 해제용)

// ── 화면 전환 ─────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${id}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screen === id);
  });
}

// ── Tesseract 지연 로딩 (성능 최적화) ────────────────────────────────────────
function loadTesseract() {
  return new Promise((resolve, reject) => {
    if (tesseractLoaded && window.Tesseract) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => { tesseractLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Tesseract 로드 실패'));
    document.head.appendChild(script);
  });
}

// ── 카메라 ───────────────────────────────────────────────────────────────────
async function startCamera() {
  // Tesseract를 카메라 진입 시점에 미리 로딩 시작 (백그라운드)
  loadTesseract().catch(() => {});

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.getElementById('btn-capture').style.display = 'none';
    document.getElementById('camera-frame').style.display = 'none';
    showToast('HTTPS 환경에서만 카메라를 사용할 수 있습니다');
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 } }
    });
    document.getElementById('camera-video').srcObject = cameraStream;
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      showToast('카메라 권한을 허용해주세요. 설정 > Safari > 카메라');
    } else {
      showToast('카메라를 사용할 수 없습니다. 갤러리를 이용해주세요');
    }
    document.getElementById('btn-capture').style.display = 'none';
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
}

// ── 사진 미리보기 표시 ────────────────────────────────────────────────────────
function showPhotoPreview(blob) {
  if (previewObjectURL) URL.revokeObjectURL(previewObjectURL);
  previewObjectURL = URL.createObjectURL(blob);
  document.getElementById('photo-preview-img').src = previewObjectURL;
  document.getElementById('photo-preview').style.display = 'block';
}

function hidePhotoPreview() {
  document.getElementById('photo-preview').style.display = 'none';
  document.getElementById('photo-preview-img').src = '';
  if (previewObjectURL) { URL.revokeObjectURL(previewObjectURL); previewObjectURL = null; }
  lastCapturedBlob = null;
}

// ── 사진 저장 (iOS 사진첩) ────────────────────────────────────────────────────
async function savePhotoToGallery() {
  if (!lastCapturedBlob) { showToast('먼저 사진을 촬영해주세요'); return; }

  const filename = `명함_${new Date().toISOString().slice(0, 10)}.jpg`;

  // 방법 1: Web Share API — iOS 15.4+ 지원
  if (navigator.share && navigator.canShare) {
    try {
      const file = new File([lastCapturedBlob], filename, { type: 'image/jpeg' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return; // 성공 시 종료
      }
    } catch (e) {
      if (e.name === 'AbortError') return; // 사용자가 취소
      // 실패 시 방법 2로 계속
    }
  }

  // 방법 2: 새 탭에서 이미지 열기 → iOS 모든 버전에서 작동
  // (새 탭에서 이미지를 길게 누르면 "사진 저장" 메뉴 나타남)
  const blobURL = URL.createObjectURL(lastCapturedBlob);
  const newTab  = window.open(blobURL, '_blank');
  if (newTab) {
    showToast('새 탭 이미지를 길게 눌러 → "사진 저장" 탭 📷');
    setTimeout(() => URL.revokeObjectURL(blobURL), 60000);
    return;
  }

  // 방법 3: 다운로드 링크 (데스크탑 / 팝업 차단 환경)
  const a = document.createElement('a');
  a.href = blobURL; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(blobURL), 1000);
  showToast('사진 다운로드 완료 ✓');
}

// ── OCR 이미지 전처리 (흑백 + 대비 강화 + 업스케일) ─────────────────────────
function preprocessForOCR(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const MIN_W = 1600;
      const scale = Math.max(1, MIN_W / (img.naturalWidth || img.width));
      const w = Math.round((img.naturalWidth  || img.width)  * scale);
      const h = Math.round((img.naturalHeight || img.height) * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      // 픽셀 단위 흑백 변환 + 대비 강화
      const id = ctx.getImageData(0, 0, w, h);
      const d  = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
        const c    = Math.min(255, Math.max(0, (gray - 128) * 1.4 + 140));
        d[i] = d[i+1] = d[i+2] = c;
      }
      ctx.putImageData(id, 0, 0);
      resolve(canvas.toDataURL('image/png')); // PNG = 무손실, OCR 정확도 높음
    };
    img.onerror = () => resolve(src); // 실패 시 원본 사용
    img.src = src;
  });
}

// ── OCR ──────────────────────────────────────────────────────────────────────
async function runOCR(imageSource) {
  setOCRStatus('명함 인식 준비 중...');
  showLoading('OCR 준비 중...');
  try {
    await loadTesseract();

    // 이미지 전처리 후 인식
    setOCRStatus('이미지 보정 중...');
    const processed = await preprocessForOCR(imageSource);

    const { data: { text } } = await Tesseract.recognize(processed, 'kor+eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          setOCRStatus(`인식 중... ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    parseOCRText(text);
    setOCRStatus('인식 완료 ✓  내용을 확인하고 수정 후 저장해주세요');
    setTimeout(() => {
      const preview = document.getElementById('photo-preview');
      const target  = (preview && preview.style.display !== 'none')
        ? preview
        : document.getElementById('card-form');
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
  } catch {
    setOCRStatus('인식 실패 — 조명을 밝게 하거나 직접 입력해주세요');
  } finally {
    hideLoading();
  }
}

function parseOCRText(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 1);

  // ── 정규식 ──
  const phoneRe = /(?:010|011|016|017|019|02|031|032|033|041|042|043|044|051|052|053|054|055|061|062|063|064|070)[-.\s]?\d{3,4}[-.\s]?\d{4}/;
  const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

  // ── 직함 키워드 ──
  const positionKw = ['대표이사','대표','부회장','회장','전무','상무','이사','부장','차장','과장','팀장','대리','사원','주임','선임','책임','수석','원장','소장','교수','박사','연구원','컨설턴트','매니저','Director','Manager','CEO','CTO','CFO','COO','VP','Engineer','Researcher','Partner','Consultant'];

  // ── 회사 키워드 ──
  const companyKw = ['(주)','㈜','주식회사','유한회사','합자회사','Inc.','Inc','Co.,','Ltd.','Ltd','Corp.','Corp','그룹','Group','사업부','연구소','대학교','대학','병원','클리닉','센터','아카데미','협회','재단'];

  let phone = '', email = '', name = '', company = '', position = '';
  const rest = [];

  for (const line of lines) {
    // 이메일
    const em = line.match(emailRe);
    if (!email && em) { email = em[0]; continue; }

    // 전화번호 (T., F., M. 등 접두사 제거)
    const clean = line.replace(/^[TtFfMm][\.\:\s]+/, '');
    const ph = clean.match(phoneRe);
    if (!phone && ph) { phone = ph[0]; continue; }

    // 직함
    if (!position && positionKw.some(k => line.includes(k))) {
      position = line; continue;
    }

    // 회사명
    if (!company && companyKw.some(k => line.includes(k))) {
      company = line; continue;
    }

    rest.push(line);
  }

  // ── 이름 추출 ──
  // 한글 이름: 2~4자 한글, 영문 이름: 영어 단어 2~3개
  if (!name) {
    const found = rest.find(l =>
      /^[가-힣]{2,4}$/.test(l) ||
      /^[A-Z][a-z]+ [A-Z][a-z]+( [A-Z][a-z]+)?$/.test(l)
    );
    if (found) { name = found; rest.splice(rest.indexOf(found), 1); }
  }

  // 남은 짧은 줄 중 회사·직함 채우기
  const shorts = rest.filter(l => l.length < 30);
  if (!name)     name     = shorts[0] || '';
  if (!company)  company  = shorts[1] || rest[0] || '';
  if (!position) position = shorts[2] || '';

  setFieldIfEmpty('field-name',     name);
  setFieldIfEmpty('field-company',  company);
  setFieldIfEmpty('field-position', position);
  setFieldIfEmpty('field-phone',    phone);
  setFieldIfEmpty('field-email',    email);
}

function setFieldIfEmpty(id, value) {
  const el = document.getElementById(id);
  if (el && !el.value && value) el.value = value;
}

function setOCRStatus(msg) {
  document.getElementById('ocr-status').textContent = msg;
}

// ── GPS ──────────────────────────────────────────────────────────────────────
function getGPS() {
  if (!navigator.geolocation) {
    document.getElementById('gps-text').textContent = '위치 기능 미지원';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      gpsData.lat = pos.coords.latitude;
      gpsData.lng = pos.coords.longitude;
      document.getElementById('gps-text').textContent =
        `GPS 기록됨 (${gpsData.lat.toFixed(4)}, ${gpsData.lng.toFixed(4)})`;
    },
    () => {
      document.getElementById('gps-text').textContent = '위치 정보 없음';
    }
  );
}

// ── Cards CRUD ────────────────────────────────────────────────────────────────
async function loadCards() {
  // 목록에는 필요한 컬럼만 (성능 최적화)
  const { data, error } = await db
    .from('business_cards')
    .select('id, name, company, position, phone, email, met_location, met_datetime, met_reason, address, gps_lat, gps_lng, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    showToast('데이터 로드 실패. 인터넷 연결을 확인해주세요');
    console.error('loadCards error:', error);
    return;
  }
  renderCards(data || []);
}

function renderCards(cards) {
  const list = document.getElementById('card-list');
  const empty = document.getElementById('empty-state');

  // DocumentFragment로 한 번에 렌더링 (성능 최적화)
  const fragment = document.createDocumentFragment();

  document.getElementById('card-count').textContent = `${cards.length}장`;

  if (cards.length === 0) {
    list.querySelectorAll('.card-item').forEach(el => el.remove());
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  list.querySelectorAll('.card-item').forEach(el => el.remove());

  cards.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'card-item';
    el.style.animationDelay = `${i * 0.04}s`;

    const metInfo = card.met_location ? `📍 ${card.met_location}` : '';
    const metDate = card.met_datetime
      ? new Date(card.met_datetime).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
      : '';

    el.innerHTML = `
      <div class="card-item-name">${esc(card.name || '이름 없음')}</div>
      <div class="card-item-company">${esc([card.company, card.position].filter(Boolean).join(' · '))}</div>
      <div class="card-item-meta">
        <span>${esc(card.phone || '')}</span>
        <span>${esc(metInfo)}</span>
        <span>${esc(metDate)}</span>
      </div>
    `;
    el.addEventListener('click', () => showDetail(card));
    fragment.appendChild(el);
  });

  list.appendChild(fragment);
}

async function saveCard(data) {
  showLoading('저장 중...');
  const { error } = await db.from('business_cards').insert([data]);
  hideLoading();
  if (error) {
    showToast('저장 실패. 인터넷 연결을 확인해주세요');
    console.error('saveCard error:', error);
    return false;
  }
  showToast('명함이 저장되었습니다 ✓');
  return true;
}

async function deleteCard(id) {
  showLoading('삭제 중...');
  const { error } = await db.from('business_cards').delete().eq('id', id);
  hideLoading();
  if (error) { showToast('삭제 실패. 다시 시도해주세요'); return; }
  currentCard = null;
  showToast('삭제되었습니다');
  showScreen('home');
  loadCards();
}

// ── 명함 상세 ─────────────────────────────────────────────────────────────────
function showDetail(card) {
  currentCard = card;

  const metDate = card.met_datetime
    ? new Date(card.met_datetime).toLocaleDateString('ko-KR', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    : '';

  const row = (label, value) =>
    value ? `<div class="detail-row">
      <span class="detail-row-label">${label}</span>
      <span class="detail-row-value">${esc(value)}</span>
    </div>` : '';

  document.getElementById('detail-card').innerHTML = `
    <div class="detail-name">${esc(card.name || '이름 없음')}</div>
    <div class="detail-company">${esc([card.company, card.position].filter(Boolean).join(' · '))}</div>
    <hr class="detail-divider">
    ${row('전화', card.phone)}
    ${row('이메일', card.email)}
    ${row('주소', card.address)}
    <hr class="detail-divider">
    ${row('만난 장소', card.met_location)}
    ${row('만난 일시', metDate)}
    ${row('메모', card.met_reason)}
  `;

  showScreen('detail');
}

// ── 명함 수정 ─────────────────────────────────────────────────────────────────
function showEditScreen(card) {
  const fields = {
    'edit-name':         card.name,
    'edit-company':      card.company,
    'edit-position':     card.position,
    'edit-phone':        card.phone,
    'edit-email':        card.email,
    'edit-address':      card.address,
    'edit-met-location': card.met_location,
    'edit-met-reason':   card.met_reason,
  };
  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  }
  if (card.met_datetime) {
    const dt = new Date(card.met_datetime);
    dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
    document.getElementById('edit-met-datetime').value = dt.toISOString().slice(0, 16);
  }
  showScreen('edit');
}

async function updateCard(id, data) {
  showLoading('수정 중...');
  const { error } = await db.from('business_cards').update(data).eq('id', id);
  hideLoading();
  if (error) {
    showToast('수정 실패. 인터넷 연결을 확인해주세요');
    console.error('updateCard error:', error);
    return false;
  }
  showToast('수정되었습니다 ✓');
  return true;
}

// ── vCard ─────────────────────────────────────────────────────────────────────
function downloadVCard(card) {
  const vcf = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${card.name || ''}`,
    `TEL:${card.phone || ''}`,
    `EMAIL:${card.email || ''}`,
    `ORG:${card.company || ''}`,
    `TITLE:${card.position || ''}`,
    `ADR:;;${card.address || ''};;;;`,
    'END:VCARD'
  ].join('\r\n');

  const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${card.name || 'contact'}.vcf`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('vCard 다운로드 완료. 파일을 열어 연락처에 추가해주세요');
}

// ── 인사 이메일 ───────────────────────────────────────────────────────────────
async function sendGreetingEmail(card) {
  const profile = getProfile();

  if (!profile.name || !profile.email) {
    showToast('내 프로필에서 이름과 이메일을 먼저 설정해주세요');
    setTimeout(() => { loadProfileForm(); showScreen('profile'); }, 1500);
    return;
  }
  if (!card.email) {
    showToast('상대방 이메일 정보가 없습니다. 수정 버튼으로 추가해주세요');
    return;
  }

  const serviceId  = profile.emailjs_service  || CONFIG.EMAILJS_SERVICE_ID;
  const templateId = profile.emailjs_template || CONFIG.EMAILJS_TEMPLATE_ID;
  const publicKey  = profile.emailjs_key      || CONFIG.EMAILJS_PUBLIC_KEY;

  if (!serviceId || !templateId || !publicKey) {
    showToast('프로필에서 EmailJS 설정을 완료해주세요');
    setTimeout(() => { loadProfileForm(); showScreen('profile'); }, 1500);
    return;
  }

  showLoading('이메일 발송 중...');
  const metDate = card.met_datetime
    ? new Date(card.met_datetime).toLocaleDateString('ko-KR')
    : '최근';

  try {
    emailjs.init(publicKey);
    await emailjs.send(serviceId, templateId, {
      to_email:      card.email,
      to_name:       card.name,
      from_name:     profile.name,
      from_email:    profile.email,
      from_phone:    profile.phone    || '',
      from_company:  profile.company  || '',
      from_position: profile.position || '',
      met_date:      metDate,
      met_location:  card.met_location || '',
      met_reason:    card.met_reason   || '',
    });
    showToast('인사 이메일을 발송했습니다 ✓');
  } catch (e) {
    console.error('emailjs error:', e);
    const msg = e?.text || e?.message || '알 수 없는 오류';
    showToast(`이메일 발송 실패: ${msg}`);
  } finally {
    hideLoading();
  }
}

// ── 프로필 ────────────────────────────────────────────────────────────────────
function getProfile() {
  try { return JSON.parse(localStorage.getItem('my_profile') || '{}'); } catch { return {}; }
}

function saveProfile(data) {
  localStorage.setItem('my_profile', JSON.stringify(data));
}

function loadProfileForm() {
  const p = getProfile();
  const map = {
    'profile-name':             p.name,
    'profile-email':            p.email,
    'profile-phone':            p.phone,
    'profile-company':          p.company,
    'profile-position':         p.position,
    'profile-emailjs-service':  p.emailjs_service,
    'profile-emailjs-template': p.emailjs_template,
    'profile-emailjs-key':      p.emailjs_key,
  };
  for (const [id, val] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  }
  updateAvatar(p.name);
}

function updateAvatar(name) {
  const el = document.getElementById('avatar-initials');
  if (el) el.textContent = name ? name.slice(0, 1) : '?';
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 3500);
}

function showLoading(msg = '처리 중...') {
  document.getElementById('loading-text').textContent = msg;
  document.getElementById('loading').classList.add('show');
}

function hideLoading() {
  document.getElementById('loading').classList.remove('show');
}

function resetScanForm() {
  document.getElementById('card-form').reset();
  document.getElementById('btn-capture').style.display = '';
  gpsData = { lat: null, lng: null };
  document.getElementById('gps-text').textContent = '위치 감지 중...';
  setOCRStatus('');
  hidePhotoPreview();

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('field-met-datetime').value = now.toISOString().slice(0, 16);
}

// ── 이벤트 바인딩 ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // 하단 네비게이션
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const screen = btn.dataset.screen;
      if (screen === 'profile') loadProfileForm();
      showScreen(screen);
    });
  });

  // FAB — 명함 추가
  document.getElementById('btn-add-card').addEventListener('click', () => {
    resetScanForm();
    showScreen('scan');
    startCamera();
    getGPS();
  });

  // 뒤로가기
  document.getElementById('btn-back-scan').addEventListener('click', () => {
    stopCamera();
    showScreen('home');
  });
  document.getElementById('btn-back-detail').addEventListener('click', () => showScreen('home'));
  document.getElementById('btn-back-edit').addEventListener('click', () => showScreen('detail'));
  document.getElementById('btn-back-profile').addEventListener('click', () => showScreen('home'));

  // 수정 버튼
  document.getElementById('btn-edit').addEventListener('click', () => {
    if (currentCard) showEditScreen(currentCard);
  });

  // 수정 폼 저장
  document.getElementById('edit-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentCard) return;
    const data = {
      name:         document.getElementById('edit-name').value.trim(),
      company:      document.getElementById('edit-company').value.trim(),
      position:     document.getElementById('edit-position').value.trim(),
      phone:        document.getElementById('edit-phone').value.trim(),
      email:        document.getElementById('edit-email').value.trim(),
      address:      document.getElementById('edit-address').value.trim(),
      met_location: document.getElementById('edit-met-location').value.trim(),
      met_datetime: document.getElementById('edit-met-datetime').value || null,
      met_reason:   document.getElementById('edit-met-reason').value.trim(),
    };
    const ok = await updateCard(currentCard.id, data);
    if (ok) {
      currentCard = { ...currentCard, ...data };
      showDetail(currentCard);
      loadCards();
    }
  });

  // 촬영
  document.getElementById('btn-capture').addEventListener('click', () => {
    const video  = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');

    // 비디오 스트림 크기 확인
    if (!video.videoWidth || !video.videoHeight) {
      showToast('카메라 준비 중입니다. 잠시 후 다시 눌러주세요');
      return;
    }

    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    stopCamera();

    // toBlob 시도, 실패 시 dataURL로 폴백
    try {
      canvas.toBlob(blob => {
        if (blob) {
          lastCapturedBlob = blob;
          showPhotoPreview(blob);
          const ocrURL = URL.createObjectURL(blob);
          runOCR(ocrURL).finally(() => URL.revokeObjectURL(ocrURL));
        } else {
          // blob이 null인 경우 dataURL 폴백
          useDateURLFallback(canvas);
        }
      }, 'image/jpeg', 0.92);
    } catch {
      useDateURLFallback(canvas);
    }
  });

  // dataURL 폴백 (toBlob 실패 시)
  function useDateURLFallback(canvas) {
    const dataURL = canvas.toDataURL('image/jpeg', 0.92);
    fetch(dataURL).then(r => r.blob()).then(blob => {
      lastCapturedBlob = blob;
      showPhotoPreview(blob);
      runOCR(dataURL);
    });
  }

  // 갤러리
  document.getElementById('btn-gallery').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    stopCamera();
    lastCapturedBlob = file;
    showPhotoPreview(file);
    const ocrURL = URL.createObjectURL(file);
    await runOCR(ocrURL);
    URL.revokeObjectURL(ocrURL);
    e.target.value = '';
  });

  // 사진 저장 버튼
  document.getElementById('btn-save-photo').addEventListener('click', savePhotoToGallery);

  // 명함 저장
  document.getElementById('card-form').addEventListener('submit', async e => {
    e.preventDefault();
    const data = {
      name:          document.getElementById('field-name').value.trim(),
      company:       document.getElementById('field-company').value.trim(),
      position:      document.getElementById('field-position').value.trim(),
      phone:         document.getElementById('field-phone').value.trim(),
      email:         document.getElementById('field-email').value.trim(),
      address:       document.getElementById('field-address').value.trim(),
      met_location:  document.getElementById('field-met-location').value.trim(),
      met_datetime:  document.getElementById('field-met-datetime').value || null,
      met_reason:    document.getElementById('field-met-reason').value.trim(),
      gps_lat:       gpsData.lat,
      gps_lng:       gpsData.lng,
    };
    if (!data.name) { showToast('이름을 입력해주세요'); return; }
    const ok = await saveCard(data);
    if (ok) { showScreen('home'); loadCards(); }
  });

  // 상세 — 연락처 저장
  document.getElementById('btn-vcard').addEventListener('click', () => {
    if (currentCard) downloadVCard(currentCard);
  });

  // 상세 — 인사 이메일
  document.getElementById('btn-email').addEventListener('click', () => {
    if (currentCard) sendGreetingEmail(currentCard);
  });

  // 상세 — 삭제
  document.getElementById('btn-delete').addEventListener('click', () => {
    if (!currentCard) return;
    if (confirm(`"${currentCard.name || '이 명함'}"을 삭제할까요?\n삭제 후 복구할 수 없습니다.`)) {
      deleteCard(currentCard.id);
    }
  });

  // 프로필 저장
  document.getElementById('profile-form').addEventListener('submit', e => {
    e.preventDefault();
    const data = {
      name:             document.getElementById('profile-name').value.trim(),
      email:            document.getElementById('profile-email').value.trim(),
      phone:            document.getElementById('profile-phone').value.trim(),
      company:          document.getElementById('profile-company').value.trim(),
      position:         document.getElementById('profile-position').value.trim(),
      emailjs_service:  document.getElementById('profile-emailjs-service').value.trim(),
      emailjs_template: document.getElementById('profile-emailjs-template').value.trim(),
      emailjs_key:      document.getElementById('profile-emailjs-key').value.trim(),
    };
    saveProfile(data);
    updateAvatar(data.name);
    showToast('프로필이 저장되었습니다 ✓');
  });

  // 초기 로딩 (병렬)
  Promise.all([
    loadCards(),
    navigator.serviceWorker
      ? navigator.serviceWorker.register('sw.js').catch(() => {})
      : Promise.resolve()
  ]);
  loadProfileForm();

  // 오프라인/온라인 감지
  window.addEventListener('online',  () => { showToast('인터넷에 연결되었습니다'); loadCards(); });
  window.addEventListener('offline', () => showToast('오프라인 상태입니다'));

  // iOS: 키보드 올라올 때 입력창 스크롤
  document.querySelectorAll('.field-input').forEach(input => {
    input.addEventListener('focus', () => {
      setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
    });
  });

  // iOS Safari 높이 재계산
  const setVH = () => document.documentElement.style.setProperty('--dvh', `${window.innerHeight}px`);
  window.addEventListener('resize', setVH);
  setVH();
});
