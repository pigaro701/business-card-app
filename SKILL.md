# Business-Card-App — Skill & 프롬프트 가이드

이 파일은 프로젝트 진행 중 사용한 Claude Code Skill, 프롬프트, 도구 목록을 기록합니다.

---

## 프로젝트 기본 정보

```
프로젝트명: Business-Card-App
설명: 명함 OCR 촬영 → 저장 → 연락처 동기화 → 인사 이메일 자동 발송
스택: HTML / Vanilla JS / Supabase / EmailJS / Google Vision API
```

---

## 사용 중인 Skills

| Skill | 용도 | 호출 방법 |
|-------|------|-----------|
| frontend-design | UI/UX 컴포넌트 생성 | `/frontend-design` |
| claude-api | Claude API 연동 시 | `/claude-api` |
| prompts.chat:prompts | 프롬프트 검색 | `/prompts.chat:prompts` |

---

## 사용 중인 MCP 도구

| MCP | 용도 |
|-----|------|
| Supabase MCP | DB 테이블 생성 / 쿼리 |
| Playwright MCP | E2E 테스트 |

---

## PRD 프롬프트 출처

- **prompts.chat ID**: `cmlcf50ex000djv04aw3i0la0`
- **작성자**: SynapticSolutionsAI
- **방식**: 시니어 PM 역할 → 질문 7개 → 3단계(Phase 1/2/3) PRD 생성
- **재사용**: `your_productfeature_idea`와 `company_context`만 바꿔서 재사용 가능

---

## 개발 단계 진행 현황

| 단계 | 내용 | 상태 |
|------|------|------|
| 0 | PRD 작성 | ✅ 완료 |
| 1 | Supabase 테이블 생성 | ⬜ 대기 |
| 2 | UI 구현 | ⬜ 대기 |
| 3 | OCR 연동 | ⬜ 대기 |
| 4 | GPS + 시간 기록 | ⬜ 대기 |
| 5 | vCard 연락처 저장 | ⬜ 대기 |
| 6 | EmailJS 이메일 발송 | ⬜ 대기 |
| 7 | 내 프로필 설정 | ⬜ 대기 |
| 8 | 테스트 | ⬜ 대기 |
