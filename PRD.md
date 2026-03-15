# PRD — Business-Card-App (명함 저장 앱)

> 프로젝트명: Business-Card-App
> 작성일: 2026-03-15
> 버전: v1.0 (MVP)

---

## Phase 1: 문제 & 컨텍스트

### 타겟 사용자
개인 / 가까운 지인 — 네트워킹이 잦은 일반인

### Pain Points
1. **데이터 종속 문제** — 시중 명함 앱은 기기 변경 시 유료 재결제 요구 + 데이터 유실
2. **비용 문제** — 기존 앱이 비쌈
3. **입력 귀찮음** — 명함 정보를 일일이 수동 입력
4. **기억 문제** — 나중에 어디서, 언제 만난 사람인지 기억 안 남

### 성공 기준
- 만난 사람의 연락처 + 만남 정보를 모바일에 체계적으로 기록
- 만난 후 상대방에게 인사 이메일 발송 → 나를 기억하게 함
- 이메일에 "언제, 어디서 만났는지" 정보 포함 → 상대방도 기억하기 쉽게

---

## Phase 2: 솔루션 & 요구사항

### 핵심 User Stories

| # | As a... | I want to... | So that... |
|---|---------|-------------|------------|
| 1 | 사용자 | 명함을 카메라로 찍으면 OCR이 자동 인식 | 수동 입력 없이 빠르게 저장 |
| 2 | 사용자 | 만난 장소, 시간, 이유를 기록 | 나중에 컨텍스트를 기억할 수 있음 |
| 3 | 사용자 | 저장된 연락처를 모바일 주소록에 추가 | 전화/문자를 바로 할 수 있음 |
| 4 | 사용자 | 만난 직후 인사 이메일을 자동 발송 | 상대방에게 나를 인상적으로 기억시킴 |
| 5 | 사용자 | 기기를 바꿔도 데이터가 유지됨 | 비용 없이 영구 보관 |

### MVP 기능 범위 (1단계)
- [x] 명함 OCR 촬영 → 자동 인식
- [x] 만난 장소 / 시간 / 이유 입력
- [x] GPS 자동 위치 기록
- [x] 모바일 연락처 저장 (vCard)
- [x] 인사 이메일 자동 발송 (EmailJS, 고정 템플릿)
- [x] 내 프로필 설정 (발신자 정보)
- [x] Supabase 클라우드 저장 (기기 변경 무관)

### 2단계 기능 (추후)
- [ ] 명함 리스트 검색 / 편집
- [ ] 명함 이미지 보관
- [ ] 태그 분류

---

## Phase 3: 기술 & 구현 계획

### 기술 스택
| 영역 | 기술 |
|------|------|
| Frontend | HTML / Vanilla JS (PWA) |
| Backend / DB | Supabase (PostgreSQL + Storage) |
| OCR | Google Vision API 또는 Tesseract.js |
| 이메일 | EmailJS |
| 위치 | Web Geolocation API |
| 연락처 저장 | vCard (.vcf) 다운로드 + Web Contacts API |

### DB 스키마

**business_cards**
```
id, user_id, name, phone, email, company, position, address,
met_location, met_datetime, met_reason,
gps_lat, gps_lng, card_image_url,
created_at
```

**user_profile**
```
id, user_id, name, email, phone, company, position,
email_template, created_at
```

### 인사 이메일 템플릿
```
제목: 안녕하세요, [내 이름]입니다 :)

[상대방 이름]님, 안녕하세요.

[날짜] [장소]에서 만나서 반가웠습니다.
[만난 이유/메모]

앞으로도 잘 부탁드립니다.

[내 이름] 드림
[내 연락처 / 직책]
```

### 구현 순서 (MVP)
1. Supabase 테이블 생성 (MCP 활용)
2. UI 구현 — frontend-design Skill 활용
3. OCR 연동 (카메라 → 자동 인식)
4. GPS + 시간 자동 기록
5. vCard 생성 → 모바일 연락처 저장
6. EmailJS → 인사 이메일 자동 발송
7. 내 프로필 설정
8. 테스트
