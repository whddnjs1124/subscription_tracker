# HLD — Sub Tracker (High-Level Design)

- **작성일**: 2026-07-16
- **관련 문서**: [PRD.md](./PRD.md)

## 1. 아키텍처 개요

Next.js 풀스택 단일 앱. 프론트(React Server/Client Components)와 백엔드(API Routes)가 한 프로젝트에 있고, Gemini 호출과 DB 접근은 전부 서버 사이드에서만 일어난다.

```
브라우저
  │  CSV 업로드 / 대시보드 조회
  ▼
Next.js (App Router)
  ├─ app/            페이지 (대시보드, 업로드, 구독 상세, 인사이트)
  ├─ app/api/        API 라우트 (얇게 유지 — 파싱·검증 후 lib/ 호출)
  └─ lib/            도메인 로직 (순수 함수 위주)
       ├─ sources/csv.ts     TransactionSource 구현체 (Papaparse)
       ├─ detection.ts       규칙 기반 반복 결제 감지
       ├─ gemini.ts          Gemini 클라이언트 + 모든 프롬프트/스키마
       └─ db.ts              Prisma 클라이언트 싱글턴
  │
  ├──► SQLite (Prisma)          로컬 데이터 저장
  └──► Gemini API (flash)       컬럼 매핑 / 가맹점 분석 / 월간 인사이트
```

### 기술 스택

| 영역 | 선택 |
|---|---|
| 프레임워크 | Next.js 15 (App Router) + TypeScript |
| 스타일 | Tailwind CSS |
| DB / ORM | SQLite + Prisma (배포 시 provider만 Postgres로 교체) |
| AI | Gemini API `gemini-2.5-flash`, JSON structured output |
| CSV | Papaparse |
| 차트 | Recharts |
| 환경변수 | `GEMINI_API_KEY` (`.env.local`) |

## 2. 데이터 모델 (Prisma)

```prisma
model Upload {
  id               String        @id @default(cuid())
  fileName         String
  bankGuess        String?       // Gemini가 추정한 은행명
  importedAt       DateTime      @default(now())
  transactions     Transaction[]
}

model Transaction {
  id              String    @id @default(cuid())
  uploadId        String
  upload          Upload    @relation(fields: [uploadId], references: [id])
  date            DateTime
  amount          Decimal   // 지출은 양수로 정규화하여 저장
  rawDescription  String    // 은행 원본 문자열
  dedupeHash      String    @unique  // sha256(date|amount|rawDescription)
  merchantId      String?
  merchant        Merchant? @relation(fields: [merchantId], references: [id])
}

model Merchant {
  id                     String         @id @default(cuid())
  rawPattern             String         @unique // 그루핑 키 (정규화된 원본 프리픽스)
  normalizedName         String         // "Spotify"
  description            String         // "음악 스트리밍 서비스"
  category               String         // entertainment | utilities | software | telecom | ...
  isSubscriptionService  Boolean        // Gemini 최종 판정
  analyzedAt             DateTime
  transactions           Transaction[]
  subscriptions          Subscription[]
}

model Subscription {
  id                   String    @id @default(cuid())
  merchantId           String
  merchant             Merchant  @relation(fields: [merchantId], references: [id])
  amount               Decimal   // 최근 결제 금액
  cadence              String    // weekly | monthly | yearly
  firstSeen            DateTime
  lastCharged          DateTime
  nextBillingEstimate  DateTime
  status               String    // active | cancelled | rejected(오탐 거부됨)
  isManual             Boolean   @default(false)
  note                 String?
}

model Insight {
  id          String   @id @default(cuid())
  month       String   @unique // "2026-07"
  content     String   // Gemini 생성 분석문 (markdown)
  generatedAt DateTime
}
```

핵심 제약:
- `Transaction.dedupeHash` unique → 같은 CSV 재업로드 시 중복 삽입이 DB 레벨에서 차단됨 (upsert/skip)
- `Merchant`가 **Gemini 분석 캐시** 역할 — `rawPattern`이 이미 있으면 API 호출 생략

## 3. 핵심 파이프라인

### 3.1 CSV 임포트 플로우

```
업로드 → Papaparse 파싱
       → [Gemini #1] 헤더 + 샘플 5행 → { dateCol, descCol, amountCol, amountSign, bankGuess }
       → 사용자에게 매핑 미리보기 표시 → 확인
       → 전체 행 정규화(날짜 파싱, 금액 부호 통일, 입금/이체 제외)
       → dedupeHash 계산 후 Transaction 일괄 저장 (중복 skip)
       → 구독 감지 파이프라인(3.2) 트리거
```

- `TransactionSource` 인터페이스: `parse(file) → NormalizedTransaction[]`. 현재 구현체는 CSV 하나지만, 향후 Plaid/Teller 커넥터가 같은 인터페이스로 들어온다.

### 3.2 구독 감지 (2단계 — 비용/정확도 균형의 핵심)

**Stage 1 — 규칙 엔진 (`lib/detection.ts`, 무료·결정적)**
1. `rawDescription`을 휴리스틱으로 정규화(숫자 꼬리·지점번호 제거)해 가맹점 그루핑
2. 그룹별로 결제 간격과 금액 검사:
   - 금액 유사성: 중앙값 대비 ±15% 이내
   - 주기성: 간격이 주간(7±2일) / 월간(30±5일) / 연간(365±10일) 패턴
   - 최소 발생 횟수: 2회 이상 (연간은 2회, 월간은 2~3회)
3. 통과한 그룹 = **구독 후보**

**Stage 2 — Gemini 보강 (`lib/gemini.ts`, 후보만 배치 호출)**
- 입력: 후보 가맹점들의 원본 문자열 + 금액 + 주기 (한 번의 호출에 여러 가맹점 배치)
- 출력(JSON 스키마 강제): `{ normalizedName, description, category, isSubscription }`
- `isSubscription: false` 판정(예: 매주 가는 마트)은 Merchant에 기록만 하고 Subscription 생성 안 함
- 결과를 `Merchant`에 저장 → 이후 업로드에서 같은 `rawPattern`은 재호출 없음

**Stage 3 — Subscription 레코드 생성/갱신**
- 기존 Subscription 있으면 `lastCharged`/`amount` 갱신 (금액 변화 시 가격 인상으로 기록)
- `nextBillingEstimate = lastCharged + cadence`
- 새로 감지된 것은 `status: active`로 생성하되 업로드 결과 화면에서 사용자 리뷰(승인 유지/거부→`rejected`)

### 3.3 Gemini 호출 규약 (`lib/gemini.ts`)

| 호출 | 시점 | 입력 | 출력 |
|---|---|---|---|
| 컬럼 매핑 | CSV 업로드 시 1회 | 헤더+샘플 5행 | 컬럼 매핑 JSON |
| 가맹점 분석 | 새 구독 후보 발생 시, 배치 | 가맹점 문자열+금액+주기 목록 | 가맹점별 분석 JSON 배열 |
| 월간 인사이트 | 인사이트 페이지 첫 조회 시(월 1회 캐시) | 구독 요약 통계 | 분석문 markdown |

공통 원칙: 모든 호출은 서버 사이드, JSON 스키마(structured output) 강제, 실패 시 1회 재시도 후 사용자에게 표시하고 파이프라인은 계속(분석 실패 가맹점은 "미분석" 상태로 남김).

## 4. 화면 / 라우트

| 라우트 | 화면 | 주요 요소 |
|---|---|---|
| `/` | 대시보드 | 월 총액·활성 구독 수 스탯 카드, 구독 리스트(다음 결제일 순), 카테고리 도넛, 월별 추이 라인 차트 |
| `/upload` | 업로드 | 드래그앤드롭 → 매핑 미리보기 → 임포트 진행 상태 → 신규 감지 리뷰(승인/거부) |
| `/subscriptions/[id]` | 구독 상세 | 결제 이력 타임라인, 가격 변동 하이라이트, 편집/해지 표시/메모 |
| `/insights` | AI 인사이트 | 월간 분석문, 안 쓰는 구독 후보, 중복 구독 경고 |

API 라우트: `POST /api/upload` (파싱+매핑), `POST /api/import` (확정 임포트+감지 트리거), `PATCH /api/subscriptions/[id]`, `GET /api/insights?month=`.

## 5. 보안 / 비용

- `GEMINI_API_KEY`는 서버 전용. 클라이언트 번들에 노출 금지 (`NEXT_PUBLIC_` 접두사 사용 금지)
- 실제 은행 CSV·SQLite DB 파일은 `.gitignore` — 저장소에는 `fixtures/`의 가짜 데이터만
- Gemini 비용 통제: 규칙 엔진 1차 필터 + Merchant 캐시 + Insight 월 단위 캐시 → 정상 사용 시 업로드당 호출 1~2회 수준

## 6. 구현 단계

| Phase | 내용 | 완료 기준 |
|---|---|---|
| 1 | 프로젝트 셋업: create-next-app, Prisma+SQLite, 스키마 마이그레이션, 레이아웃 셸 | dev 서버 뜨고 빈 대시보드 렌더링 |
| 2 | CSV 업로드·임포트: 업로드 API, Gemini 컬럼 매핑, 미리보기→저장, `fixtures/` 샘플 CSV 제작 | 샘플 CSV가 Transaction으로 저장, 재업로드 시 중복 없음 |
| 3 | 구독 감지: 규칙 엔진, Gemini 가맹점 분석, Merchant 캐시, Subscription 생성, 리뷰 UI | 심어둔 구독 전부 감지 + 일반 쇼핑 미감지 |
| 4 | 대시보드·차트: 스탯 카드, 리스트, Recharts 도넛/라인, 구독 상세 페이지 (**차트 작업 전 `dataviz` 스킬 로드**) | PRD §8-3 충족 |
| 5 | 인사이트·마무리: 월간 인사이트, 데모 시드, (선택) Auth.js+Neon+Vercel 배포 | 데모 모드로 전체 플로우 시연 가능 |

각 Phase 종료 시: `npm run dev`로 실제 브라우저 플로우 확인 + `npm run build` + `npx tsc --noEmit` 통과.

## 7. 향후 확장 대비

- **Plaid/Teller 연동**: `lib/sources/`에 새 `TransactionSource` 구현체 추가 → 이후 파이프라인(감지·분석·대시보드)은 수정 없이 동작
- **Postgres 전환**: Prisma datasource provider 교체 + 마이그레이션 재생성으로 완결
- **알림**: `nextBillingEstimate` 기반 크론 작업 — 스키마 변경 불필요
