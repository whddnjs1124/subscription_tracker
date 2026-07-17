# HLD — Sub Tracker (High-Level Design)

- **작성일**: 2026-07-16 (최종 갱신: 2026-07-17 — 실제 구현 반영 + Phase 6 설계 추가)
- **관련 문서**: [PRD.md](./PRD.md) · [PHASE6.md](./PHASE6.md)

> **(P6)** 표시는 Phase 6에서 추가된 설계다 (구현 완료). 배경과 검증 절차는 [PHASE6.md](./PHASE6.md).

## 1. 아키텍처 개요

Next.js 풀스택 단일 앱. 프론트(React Server/Client Components)와 백엔드(API Routes)가 한 프로젝트에 있고, Gemini 호출과 DB 접근은 전부 서버 사이드에서만 일어난다.

```
브라우저
  │  CSV/PDF 업로드 / 대시보드 조회        (미인증 요청은 middleware가 /login으로)
  ▼
Next.js (App Router)
  ├─ middleware.ts   라우트 보호 (edge-safe auth.config.ts)
  ├─ app/            페이지 (대시보드, 업로드, 거래, 구독 목록/상세, 인사이트, 설정, 로그인/가입)
  ├─ app/api/        API 라우트 (얇게 유지 — 파싱·검증 후 lib/ 호출)
  └─ lib/            도메인 로직 (순수 함수 위주)
       ├─ sources/csv.ts     TransactionSource 구현체 (Papaparse)
       ├─ pdf.ts             PDF 텍스트 추출 (unpdf)
       ├─ import.ts          정규화된 거래의 공통 임포트 경로
       ├─ detection.ts       규칙 기반 반복 결제 감지 (순수)
       ├─ detect.ts          감지 오케스트레이션 (DB + Gemini)
       ├─ lifecycle.ts (P6)  자동 stale 처리
       ├─ insights.ts        결정적 인사이트 통계
       ├─ gemini.ts          Gemini 클라이언트 + 모든 프롬프트/스키마
       ├─ session.ts         getUserId()
       └─ db.ts              Prisma 클라이언트 싱글턴
  │
  ├──► Postgres (Neon, Prisma)  로컬 dev·프로덕션 공용
  └──► Gemini API (flash-lite)  컬럼 매핑 / PDF 구조화 / 가맹점 분석 / 월간 인사이트
```

### 기술 스택 (실제 설치 버전)

| 영역 | 선택 |
|---|---|
| 프레임워크 | **Next.js 16.2** (App Router, Turbopack) + React 19 + TypeScript |
| 스타일 | **Tailwind v4** (`@import "tailwindcss"`, `tailwind.config.js` 없음) |
| DB / ORM | **Postgres (Neon) + Prisma 6** — 로컬·배포 모두 동일. `prisma db push`로 동기화하며 **마이그레이션 파일 없음** |
| 인증 | **Auth.js v5** (next-auth beta), 이메일+비밀번호(Credentials), JWT 세션, bcryptjs |
| AI | **`@google/genai`** SDK, 모델 **`gemini-flash-lite-latest`**, JSON structured output |
| CSV / PDF | Papaparse / unpdf |
| 차트 | Recharts |
| 환경변수 | `GEMINI_API_KEY`·`AUTH_SECRET` (`.env.local`), `DATABASE_URL` (`.env`) |
| 배포 | Vercel |

> 초안의 Next 15 / SQLite / `gemini-2.5-flash`는 실제와 달라 교정했다. Prisma는 **v6에 고정** — v7은 스키마의 `url = env()`를 없애고 네이티브 드라이버 어댑터를 요구한다.

## 2. 데이터 모델 (Prisma)

모든 행은 `User`가 소유한다. 모든 쿼리·라우트·페이지는 `userId`로 필터하고, dedupe/캐시 unique는 **per-user**다 (두 사용자가 같은 청구나 같은 가맹점 패턴을 가질 수 있으므로). 실제 정의는 `prisma/schema.prisma`가 정본이며, 아래는 요약이다.

```prisma
model User {
  id            String  @id @default(cuid())
  email         String  @unique
  passwordHash  String            // bcryptjs
  name          String?
  // uploads / transactions / merchants / subscriptions / insights — 전부 onDelete: Cascade
}

model Upload {
  id               String   @id @default(cuid())
  userId           String            // → User (Cascade)
  fileName         String
  bankGuess        String?           // Gemini가 추정한 은행명
  importedAt       DateTime @default(now())
  transactionCount Int      @default(0)
}

model Transaction {
  id              String    @id @default(cuid())
  userId          String            // → User (Cascade)
  uploadId        String            // → Upload (Cascade)
  date            DateTime
  amount          Decimal           // 지출은 양수로 정규화하여 저장
  rawDescription  String            // 은행 원본 문자열
  dedupeHash      String            // sha256(date|amount|rawDescription)
  merchantId      String?           // null = 아직 미분석 (P6에서 재감지 배너의 신호로 사용)

  @@unique([userId, dedupeHash])
}

model Merchant {
  id                     String   @id @default(cuid())
  userId                 String            // → User (Cascade)
  rawPattern             String            // 그루핑 키 (정규화된 원본 프리픽스)
  normalizedName         String            // "Spotify"
  description            String            // "음악 스트리밍 서비스"
  category               String            // lib/categories.ts의 MERCHANT_CATEGORIES
  isSubscriptionService  Boolean           // Gemini 최종 판정
  analyzedAt             DateTime @default(now())

  @@unique([userId, rawPattern])   // 가맹점 캐시는 per-user (원본 문자열 유출 방지)
}

model Subscription {
  id                   String   @id @default(cuid())
  userId               String            // → User (Cascade)
  merchantId           String            // → Merchant (Cascade)
  amount               Decimal           // 최근 결제 금액
  cadence              String            // weekly | monthly | yearly
  firstSeen            DateTime
  lastCharged          DateTime
  nextBillingEstimate  DateTime
  status               String   @default("active") // active | stale(P6) | cancelled | rejected
  userEdited           Boolean  @default(false)    // (P6)
  isManual             Boolean  @default(false)
  note                 String?
}

model Insight {
  id          String   @id @default(cuid())
  userId      String            // → User (Cascade)
  month       String            // "2026-07"
  content     String            // Gemini 생성 분석문 (markdown)
  generatedAt DateTime @default(now())

  @@unique([userId, month])
}
```

핵심 제약:
- `@@unique([userId, dedupeHash])` → 같은 CSV 재업로드 시 중복 삽입이 DB 레벨에서 차단됨 (skip)
- `Merchant`가 **Gemini 분석 캐시** 역할 — `(userId, rawPattern)`이 이미 있으면 API 호출 생략
- `User` 삭제는 cascade로 모든 소유 데이터를 지운다 → (P6) 계정 삭제가 `user.delete` 한 줄로 끝난다

### 2.1 구독 상태 모델 **(P6)**

`status`의 네 값은 **누가 설정할 수 있는가**로 나뉜다. 이 분리가 이 설계의 핵심이다:

| 값 | 설정 주체 | 의미 |
|---|---|---|
| `active` | 시스템 + 사용자 | 정상 청구 중 |
| `stale` | **시스템 전용** | 예상 주기 2배 동안 청구 없음 → 자동 비활성 추정. 총액에서 제외 |
| `cancelled` | **사용자 전용** | 사용자가 해지했다고 표시 |
| `rejected` | 사용자 전용 | 오탐이라 거부 |

컬럼 하나로 "자동으로 꺼진 것"과 "내가 끈 것"이 구분되고, 서로의 의도를 덮어쓸 수 없다. 감지 파이프라인은 `cancelled`를 절대 쓰지 않고, PATCH 라우트는 `stale`을 절대 받지 않는다.

**auto-revive 정책**: `stale`은 새 청구가 잡히면 자동으로 `active`로 돌아온다 (시스템이 내린 판단이므로 시스템이 되돌린다). `cancelled`는 청구가 계속 잡혀도 자동 복귀하지 않고 **청구 데이터만 갱신**한다 — "해지했는데 아직 청구되고 있다"를 사용자에게 보여주는 게 더 유용하기 때문이다. 복귀는 사용자의 Reactivate로만.

`userEdited`는 사용자가 `amount`/`cadence`/`nextBillingEstimate`를 고쳤음을 뜻하며, 재감지가 그 필드를 덮어쓰지 못하게 막는다 (§3.2 Stage 3). 이게 없으면 다음 업로드마다 편집이 되돌아가 편집 기능 자체가 무의미해진다.

## 3. 핵심 파이프라인

### 3.1 임포트 플로우 (CSV / PDF)

```
CSV 업로드 → Papaparse 파싱
          → [Gemini] 헤더 + 샘플 5행 → { dateCol, descCol, amountCol, amountSign, bankGuess }
          → 사용자에게 매핑 미리보기 표시 → 확인
                                    │
PDF 업로드 → unpdf 텍스트 추출          │
          → [Gemini] 텍스트 → 거래 배열 (차변 = 지출)
                                    │
                                    ▼
       → 전체 행 정규화(날짜 파싱, 금액 부호 통일, 입금/이체 제외)
       → dedupeHash 계산 후 Transaction 일괄 저장 (중복 skip)   ← lib/import.ts (공통)
       → 구독 감지 파이프라인(3.2) 트리거 (실패해도 비치명적)
```

- `POST /api/upload`은 content-type으로 분기한다: CSV는 JSON `{csvText}`, PDF는 multipart. 두 경로 모두 `lib/import.ts`의 `importNormalized`로 합류한다
- `TransactionSource` 인터페이스: `parse(file) → NormalizedTransaction[]`. 향후 Plaid/Teller 커넥터가 같은 인터페이스로 들어온다

### 3.2 구독 감지 (2단계 — 비용/정확도 균형의 핵심)

**Stage 1 — 규칙 엔진 (`lib/detection.ts`, 무료·결정적)**
1. `rawDescription`을 휴리스틱으로 정규화(숫자 꼬리·지점번호 제거)해 가맹점 그루핑 (`merchantKey`)
2. 그룹별로 결제 간격과 금액 검사:
   - 금액 유사성: 중앙값 대비 ±15% 이내
   - 주기성: 간격이 주간(7±2일) / 월간(30±5일) / 연간(365±10일) 패턴
   - 최소 발생 횟수: 2회 이상 (연간은 2회, 월간은 2~3회)
3. 통과한 그룹 = **구독 후보**, 각자의 cadence가 붙는다

**Stage 2 — Gemini 보강 (`lib/detect.ts`의 `enrichMerchants` → `lib/gemini.ts`)**
- 대상은 **캐시에 없는 모든 고유 가맹점**이다. 후보만이 아니다 — 구독이 아닌 거래도 대시보드/거래 목록에서 사람이 읽을 이름과 카테고리를 가져야 하기 때문. 후보가 아닌 가맹점은 cadence를 `one-time`으로 넘긴다
- 40개씩 배치 호출. 입력: 원본 문자열 + 금액 + 주기 + 발생 횟수
- 출력(JSON 스키마 강제): `{ normalizedName, description, category, isSubscription }`
- `isSubscription: false` 판정(예: 매주 가는 마트, 카드 자동납부)은 Merchant에 기록만 하고 Subscription 생성 안 함
- 결과를 `Merchant`에 저장 → 이후 업로드에서 같은 `(userId, rawPattern)`은 재호출 없음. 모든 Transaction은 자기 Merchant에 연결된다(멱등)

> **비용 관점에서 중요한 구분**: "가맹점 단위"이지 "거래 단위"가 아니다. 수천 건의 거래도 고유 가맹점 수십 개로 접히고, 한 번 분석된 가맹점은 영구 캐시된다. 즉 호출량은 **거래량이 아니라 새 가맹점 수**에 비례한다 — 두 번째 업로드부터는 대개 0회다. (초안 HLD는 "후보만 호출"로 적었으나 구현은 위와 같다.)

**Stage 3 — Subscription 레코드 생성/갱신 (`lib/detect.ts`)**
- 기존 Subscription 있으면 `lastCharged`/`amount` 갱신 (금액 변화 시 가격 인상으로 기록)
- `nextBillingEstimate = lastCharged + cadence`
- 새로 감지된 것은 `status: active`로 생성하되 업로드 결과 화면에서 사용자 리뷰(승인 유지/거부→`rejected`)
- 기존 구독의 상태별 처리 **(P6)** — §2.1의 정책을 코드로 옮긴 것:

  | 기존 status | 처리 |
  |---|---|
  | `rejected` | skip (사용자 판단 존중) |
  | `stale` + 더 새로운 청구 발견 | **auto-revive** → `active` |
  | `cancelled` | 청구 데이터만 갱신, auto-revive 안 함 |
  | `userEdited: true` | `amount`/`cadence` **보존**, `lastCharged`/`firstSeen`만 갱신, `nextBillingEstimate`는 사용자 cadence 기준 재계산 |

**Stage 4 — 생애주기 정리 (`lib/lifecycle.ts`) (P6)**
- `applyStaleStatus(userId)`: `lastCharged`가 예상 주기의 2배보다 오래됐고 `status: "active"`인 구독을 `stale`로 내린다 (weekly 14일 / monthly 60일 / yearly 730일)
- **`isManual: false`인 행만 대상.** 수동 추가 구독은 생성 시점의 `lastCharged`가 갱신되지 않으므로, 이 조건이 없으면 사용자가 손으로 넣은 구독이 전부 stale로 사라진다
- 호출 지점: 감지 패스 끝(Stage 3 이후 — revive된 것이 같은 패스에서 정리되도록) + 대시보드 로드 시. 후자는 write-on-read지만, 감지 실행 때만 하면 재업로드를 안 하는 사용자의 상태가 영영 고정된다

**감지 결과 리포팅 (P6)** — `detectSubscriptions`는 `{ candidates, merchantsAnalyzed, merchantsPending, quotaExhausted, staleMarked, subscriptions }`를 반환한다. 쿼터 소진을 **조용히 삼키지 않고** 구조화해 올려, UI가 "구독 0개"가 아니라 "N개 가맹점 미분석 + 재감지" 를 보여줄 수 있게 하는 것이 목적이다.

### 3.3 Gemini 호출 규약 (`lib/gemini.ts`)

| 호출 | 시점 | 입력 | 출력 | 실패 시 |
|---|---|---|---|---|
| 컬럼 매핑 | CSV 업로드 시 1회 | 헤더+샘플 5행 | 컬럼 매핑 JSON | 헤더명 휴리스틱(`heuristicMapping`)으로 폴백 |
| PDF 구조화 | PDF 업로드 시 1회 | 추출된 텍스트 | 거래 배열 JSON | **폴백 없음** — PDF 경로는 Gemini 필수 |
| 가맹점 분석 | 새 가맹점 발생 시, 배치(40개씩) | 가맹점 문자열+금액+주기 목록 | 가맹점별 분석 JSON 배열 | 해당 배치 미분석으로 남김 + 리포트 |
| 월간 인사이트 | 인사이트 페이지 첫 조회 시(월 1회 캐시) | 구독 요약 통계 | 분석문 markdown | 503 반환 |

공통 원칙: 모든 호출은 서버 사이드, JSON 스키마(structured output) 강제, 실패해도 파이프라인은 계속(분석 실패 가맹점은 "미분석"으로 남고 다음 감지에서 재시도 — 감지는 멱등하다).

**재시도 규약 (P6)**: 429 / `RESOURCE_EXHAUSTED`는 `GeminiQuotaError`로 **즉시 실패**한다 — 일일 쿼터에 즉시 재시도를 쏘는 건 두 번째 시도를 낭비할 뿐이다. 그 외 에러(일시적 네트워크 등)만 기존대로 1회 재시도. 가맹점 분석 루프는 쿼터 에러를 만나면 남은 배치를 돌지 않고 중단하고 `quotaExhausted: true`를 올린다.

## 4. 화면 / 라우트

| 라우트 | 화면 | 주요 요소 |
|---|---|---|
| `/` | 대시보드 | 월 총액·활성 구독 수 스탯 카드, 구독 리스트(다음 결제일 순), 카테고리 도넛, 월별 추이 라인 차트 · **(P6)** 다가오는 결제 섹션(30일, 주 단위 그룹), stale/재감지 배너, overdue 배지 |
| `/upload` | 업로드 | 드래그앤드롭(CSV/PDF) → 매핑 미리보기 → 임포트 진행 상태 → 신규 감지 리뷰(승인/거부) · **(P6)** 쿼터 경고 + 거부 Undo |
| `/transactions` | 거래 목록 | 전체 거래 · **(P6)** 검색·카테고리·월 필터 + 페이지네이션(50/page), 필터 반영 합계 |
| `/subscriptions` **(P6)** | 구독 목록 | 상태 탭(active/stale/cancelled/rejected) + 탭별 카운트, Reactivate |
| `/subscriptions/[id]` | 구독 상세 | 결제 이력 타임라인, 가격 변동 하이라이트, 편집/해지 표시/메모 · **(P6)** 금액·주기·카테고리·다음 결제일 편집 |
| `/insights` | AI 인사이트 | 월간 분석문, 안 쓰는 구독 후보, 중복 구독 경고 |
| `/settings` **(P6)** | 설정 | 비밀번호 변경, 데이터 내보내기(JSON/CSV), 계정 삭제 |
| `/login`, `/signup` | 인증 | 이메일+비밀번호 |

**(P6)** 라우트 레벨 상태 파일 추가: `app/loading.tsx`(스켈레톤, 전역 1개) · `app/error.tsx`(재시도) · `app/not-found.tsx`.

API 라우트:

| 라우트 | 역할 |
|---|---|
| `POST /api/upload` | 파싱 + 컬럼 매핑 (CSV는 JSON `{csvText}`, PDF는 multipart — content-type으로 분기) |
| `POST /api/import` | 확정 임포트 + 감지 트리거 (감지 실패는 비치명적) |
| `POST /api/detect` | 감지 재실행 (멱등) — **(P6)** 재감지 버튼의 대상 |
| `POST /api/subscriptions` | 수동 구독 추가 |
| `PATCH /api/subscriptions/[id]` | status/note/name · **(P6)** amount/cadence/category/nextBillingEstimate 추가 (`stale`은 거부, 값 변경 시 `userEdited: true`) |
| `DELETE /api/subscriptions/[id]` | 구독 삭제 |
| `GET /api/insights?month=` | 월간 인사이트 (월 캐시) |
| `POST /api/reset` | 로그인한 사용자의 데이터만 삭제 |
| `POST /api/signup` | 회원가입 (middleware 예외) |
| `POST /api/account/password` **(P6)** | 비밀번호 변경 (현재 비번 검증) |
| `DELETE /api/account` **(P6)** | 계정 삭제 (cascade) |
| `GET /api/export?format=json\|csv` **(P6)** | 데이터 내보내기 (attachment) |

## 5. 보안 / 비용

- `GEMINI_API_KEY`·`AUTH_SECRET`·`DATABASE_URL`은 서버 전용. 클라이언트 번들에 노출 금지 (`NEXT_PUBLIC_` 접두사 사용 금지)
- 실제 은행 CSV·로컬 DB 파일은 `.gitignore` — 저장소에는 `fixtures/`의 가짜 데이터만
- **데이터 격리**: 모든 쿼리는 `getUserId()`로 스코프한다. 상세/수정 라우트는 `where: { id, userId }`처럼 소유권을 함께 검사해 ID 추측으로 남의 행에 닿지 못하게 한다
- 미인증 요청은 `middleware.ts`가 `/login`으로 리다이렉트 (`api/signup`은 예외)
- Gemini 비용 통제: 가맹점 단위 배치(40개) + Merchant 영구 캐시 + Insight 월 단위 캐시 → **호출량은 새 가맹점 수에 비례하고 거래량과 무관하다.** 첫 업로드는 컬럼 매핑 1회 + 가맹점 배치 1~2회, 두 번째 업로드부터는 새 가맹점이 없으면 0회
- **무료 티어 쿼터가 빡빡하다** (하루 수십 회). 소진 시 429 `RESOURCE_EXHAUSTED`가 오며 앱은 우아하게 degrade한다: 컬럼 매핑은 휴리스틱 폴백, 감지 실패는 비치명적(거래는 저장되고 감지는 멱등하게 재시도). **(P6)** 이 상황을 사용자에게 알리고 재감지 버튼을 주는 것이 Phase 6의 목표 중 하나
- **(P6)** 계정 삭제는 `User` cascade에 의존한다 — 새 모델을 추가하면 `onDelete: Cascade`를 붙여야 삭제에서 누락되지 않는다

## 6. 구현 단계

| Phase | 내용 | 완료 기준 |
|---|---|---|
| 1 | 프로젝트 셋업: create-next-app, Prisma+SQLite*, 스키마 마이그레이션, 레이아웃 셸 | dev 서버 뜨고 빈 대시보드 렌더링 |
| 2 | CSV 업로드·임포트: 업로드 API, Gemini 컬럼 매핑, 미리보기→저장, `fixtures/` 샘플 CSV 제작 | 샘플 CSV가 Transaction으로 저장, 재업로드 시 중복 없음 |
| 3 | 구독 감지: 규칙 엔진, Gemini 가맹점 분석, Merchant 캐시, Subscription 생성, 리뷰 UI | 심어둔 구독 전부 감지 + 일반 쇼핑 미감지 |
| 4 | 대시보드·차트: 스탯 카드, 리스트, Recharts 도넛/라인, 구독 상세 페이지 (**차트 작업 전 `dataviz` 스킬 로드**) | PRD §8-3 충족 |
| 5 | 인사이트·마무리: 월간 인사이트, 데모 시드, (선택) Auth.js+Neon+Vercel 배포 | 데모 모드로 전체 플로우 시연 가능 |
| **6** | **생애주기·감지 UX·화면 상태·설정** — 자동 stale + 상태별 목록 + 전체 편집(`userEdited`), 쿼터 실패 리포팅 + 재감지, loading/error/404 + 거래 필터·페이지네이션, 다가오는 결제 + `/settings`(비번 변경·내보내기·계정 삭제) | PRD §8.2 충족 · 상세 절차와 검증은 [PHASE6.md](./PHASE6.md) |

1–6 모두 **완료**(+ 5 이후 Postgres 전환과 멀티유저 auth).

\* 표는 당시 진행한 내용의 기록이다. Phase 1의 SQLite는 이후 Neon Postgres로 교체됐다 — 현재 스택은 §1을 보라.

각 Phase 종료 시: `npm run dev`로 실제 브라우저 플로우 확인 + `npm run build` + `npm run typecheck` 통과.

## 7. 향후 확장 대비

- **Plaid/Teller 연동**: `lib/sources/`에 새 `TransactionSource` 구현체 추가 → 이후 파이프라인(감지·분석·대시보드)은 수정 없이 동작
- ~~**Postgres 전환**~~: **완료** — provider를 `postgresql`로 바꾸고 Neon 연결. SQLite 마이그레이션은 제거했고 이후로는 `prisma db push`로 동기화한다
- **알림 발송**: `nextBillingEstimate` 기반 크론 작업 — 스키마 변경 불필요. Phase 6이 "다가오는 결제" 화면과 생애주기 상태를 만들어 두므로, 알림은 **stale/cancelled를 제외한 active 구독**만 대상으로 하면 된다
- **다중 통화**: `Transaction`/`Subscription`에 통화 필드 + `lib/format.ts`의 하드코딩된 USD/en-US 제거 필요 (현재 전 구간 USD 가정)
