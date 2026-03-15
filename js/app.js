// ── Supabase 초기화 ──────────────────────────────────────────────────────────
const db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// ── 상태 ─────────────────────────────────────────────────────────────────────
let currentCard = null;
let gpsData = { lat: null, lng: null };
let cameraStream = null;

// ── 화면 전환 ─────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${id}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screen === id);
  });
}

// ── 카메라 ───────────────────────────────────────────────────────────────────
async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 } }
    });
    document.getElementById('camera-video').srcObject = cameraStream;
  } catch {
    showToast('카메라 권한이 필요합니다');
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
}

function captureFrame() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

// ── OCR ──────────────────────────────────────────────────────────────────────
async function runOCR(imageSource) {
  setOCRStatus('명함 인식 중...');
  showLoading('OCR 처리 중...');
  try {
    const { data: { text } } = await Tesseract.recognize(imageSource, 'kor+eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          setOCRStatus(`인식 중... ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    parseOCRText(text);
    setOCRStatus('인식 완료 — 내용을 확인하고 수정해주세요');
  } catch {
    setOCRStatus('인식 실패 — 직접 입력해주세요');
  } finally {
    hideLoading();
  }
}

function parseOCRText(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const phoneRe = /[\d]{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4}/;
  const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

  let phone = '', email = '';
  const rest = [];

  for (const line of lines) {
    if (!email && emailRe.test(line)) { email = line.match(emailRe)[0]; continue; }
    if (!phone && phoneRe.test(line)) { phone = line.match(phoneRe)[0]; continue; }
    rest.push(line);
  }

  const short = rest.filter(l => l.length < 20);
  setFieldIfEmpty('field-name', short[0] || '');
  setFieldIfEmpty('field-company', short[1] || '');
  setFieldIfEmpty('field-position', short[2] || '');
  setFieldIfEmpty('field-phone', phone);
  setFieldIfEmpty('field-email', email);
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
        `GPS: ${gpsData.lat.toFixed(5)}, ${gpsData.lng.toFixed(5)}`;
    },
    () => {
      document.getElementById('gps-text').textContent = '위치 정보 없음';
    }
  );
}

// ── Cards CRUD ────────────────────────────────────────────────────────────────
async function loadCards() {
  const { data, error } = await db
    .from('business_cards')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) { showToast('데이터 로드 실패'); return; }
  renderCards(data || []);
}

function renderCards(cards) {
  const list = document.getElementById('card-list');
  const empty = document.getElementById('empty-state');
  list.querySelectorAll('.card-item').forEach(el => el.remove());

  const count = document.getElementById('card-count');
  count.textContent = `${cards.length}장`;

  if (cards.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

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
    list.insertBefore(el, empty);
  });
}

async function saveCard(data) {
  showLoading('저장 중...');
  const { error } = await db.from('business_cards').insert([data]);
  hideLoading();
  if (error) { showToast('저장 실패: ' + error.message); return false; }
  showToast('명함이 저장되었습니다');
  return true;
}

async function deleteCard(id) {
  showLoading('삭제 중...');
  const { error } = await db.from('business_cards').delete().eq('id', id);
  hideLoading();
  if (error) { showToast('삭제 실패'); return; }
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
  showToast('vCard 다운로드 완료');
}

// ── 인사 이메일 ───────────────────────────────────────────────────────────────
async function sendGreetingEmail(card) {
  const profile = getProfile();

  if (!profile.name || !profile.email) {
    showToast('내 프로필(이름, 이메일)을 먼저 설정해주세요');
    return;
  }
  if (!card.email) {
    showToast('상대방 이메일 정보가 없습니다');
    return;
  }

  const serviceId  = profile.emailjs_service  || CONFIG.EMAILJS_SERVICE_ID;
  const templateId = profile.emailjs_template || CONFIG.EMAILJS_TEMPLATE_ID;
  const publicKey  = profile.emailjs_key      || CONFIG.EMAILJS_PUBLIC_KEY;

  if (!serviceId || !templateId || !publicKey) {
    showToast('프로필에서 EmailJS 설정을 완료해주세요');
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
    showToast('이메일 발송 실패: ' + (e?.text || '설정을 확인해주세요'));
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
  const fields = ['name', 'email', 'phone', 'company', 'position',
                  'emailjs_service', 'emailjs_template', 'emailjs_key'];
  fields.forEach(k => {
    const el = document.getElementById(`profile-${k.replace('_', '-')}`);
    // handle compound ids
    const el2 = document.getElementById(`profile-emailjs-${k.replace('emailjs_', '')}`);
    const target = el || el2;
    if (target && p[k]) target.value = p[k];
  });
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
  toast._t = setTimeout(() => toast.classList.remove('show'), 3000);
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
  gpsData = { lat: null, lng: null };
  document.getElementById('gps-text').textContent = '위치 감지 중...';
  setOCRStatus('');

  // 현재 시간 자동 입력
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
  document.getElementById('btn-back-profile').addEventListener('click', () => showScreen('home'));

  // 촬영
  document.getElementById('btn-capture').addEventListener('click', async () => {
    const img = captureFrame();
    stopCamera();
    await runOCR(img);
  });

  // 갤러리
  document.getElementById('btn-gallery').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    stopCamera();
    await runOCR(URL.createObjectURL(file));
    e.target.value = '';
  });

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
    if (confirm(`"${currentCard.name || '이 명함'}"을 삭제할까요?`)) {
      deleteCard(currentCard.id);
    }
  });

  // 프로필 저장
  document.getElementById('profile-form').addEventListener('submit', e => {
    e.preventDefault();
    const data = {
      name:            document.getElementById('profile-name').value.trim(),
      email:           document.getElementById('profile-email').value.trim(),
      phone:           document.getElementById('profile-phone').value.trim(),
      company:         document.getElementById('profile-company').value.trim(),
      position:        document.getElementById('profile-position').value.trim(),
      emailjs_service: document.getElementById('profile-emailjs-service').value.trim(),
      emailjs_template:document.getElementById('profile-emailjs-template').value.trim(),
      emailjs_key:     document.getElementById('profile-emailjs-key').value.trim(),
    };
    saveProfile(data);
    updateAvatar(data.name);
    showToast('프로필이 저장되었습니다');
  });

  // 초기 로딩
  loadCards();
  loadProfileForm();

  // PWA Service Worker 등록
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
