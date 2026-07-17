# Phase 6 — 구독 라이프사이클 · 감지 실패 UX · 라우트 상태 · 결제 예정/설정

- **작성일**: 2026-07-17
- **상태**: 계획 승인됨, **미구현**
- **관련 문서**: [PRD.md](./PRD.md) · [HLD.md](./HLD.md)

Phase 1–5(스캐폴드 → 임포트 → 감지 → 대시보드 → 인사이트/데모)와 그 이후의 Postgres 전환·멀티유저 auth가 끝난 상태에서, 앱 전체를 점검해 나온 네 가지 구멍을 메우는 단계다. 이 문서가 구현 세션이 읽는 단일 소스다.

## 0. 왜 이 작업인가 (발견된 문제)

| # | 문제 | 근거 |
|---|---|---|
| P1 | 청구가 끊긴 구독이 영원히 `active`로 남아 월/연 합계를 계속 부풀린다. 자동으로 상태가 바뀌는 경로가 없다 | `lib/detect.ts`는 현재 청구가 있는 구독만 생성/갱신. 해지는 수동 버튼뿐 |
| P2 | "결제 임박" 배지가 **과거 날짜에도** 붙는다 | `app/page.tsx:72` — `(d - now) <= 7일`은 음수일 때도 참 |
| P3 | 편집이 이름/메모만 가능. AI가 금액·주기·카테고리를 틀리면 고칠 방법이 없다 | `components/subscription-actions.tsx` → `patch({ name, note })` |
| P4 | `cancelled`/`rejected` 구독을 찾을 화면이 없다. 대시보드는 `status: "active"`만 조회 | `app/page.tsx:22`. 복구는 URL을 외워야 가능 |
| P5 | Gemini 쿼터(429) 소진 시 배치를 **조용히 건너뛰어** "구독 0개"로 보인다 — 사용자는 "구독이 없다"로 오해 | `lib/detect.ts:110-113`의 `catch { continue }` |
| P6 | `loading.tsx` / `error.tsx` / `not-found.tsx`가 전무 | `app/` 전체에 없음 |
| P7 | Transactions가 전체를 한 번에 렌더. 검색·필터·페이지네이션 없음 | `app/transactions/page.tsx:15-21` |
| P8 | 결제 예정을 모아 보는 화면 없음. 설정(비번 변경·내보내기·계정 삭제) 없음 | 라우트 자체가 없음 |

## 1. 스키마 (가장 먼저)

`prisma/schema.prisma`의 `Subscription`에 두 가지 추가 — 둘 다 default가 있는 additive 변경이므로 `npm run db:push`로 안전하게 반영된다 (이 저장소는 마이그레이션 파일을 쓰지 않는다).

```prisma
status     String  @default("active") // active | stale | cancelled | rejected
userEdited Boolean @default(false)    // 사용자가 amount/cadence/nextBilling을 고침 → 재감지가 덮어쓰지 않음
```

**상태 값의 소유권을 나눈다** — 이게 이 단계의 핵심 설계다:

- **`stale` = 시스템 전용.** 자동 비활성 감지로만 설정된다. 사용자가 PATCH로 넣을 수 없다.
- **`cancelled` = 사용자 전용.** 시스템이 절대 설정하지 않는다.

컬럼 하나로 "자동으로 꺼진 것"과 "내가 끈 것"이 구분되고, 서로의 의도를 덮어쓸 일이 없다.

`userEdited`는 필드별 플래그가 아닌 단일 boolean이다. 단순함을 택한 대가로, 편집된 구독은 `nextBillingEstimate`도 재감지 때 `lastCharged + 사용자 cadence`로 재계산된다(사용자가 손으로 넣은 날짜는 유지되지 않음). 허용 가능한 트레이드오프이며, 문제가 되면 필드별 플래그로 승격한다.

## 2. `lib/gemini.ts` — 쿼터 에러 타입화

현재 `generateJson`(28-59행)은 모든 에러를 `new Error("Gemini request failed after retry: ...")`로 감싸 429의 정체를 잃는다. 게다가 일일 쿼터 소진에 **즉시** 재시도를 한 번 더 쏜다(무의미).

1. 추가:
   ```ts
   export class GeminiQuotaError extends Error { readonly quota = true; }
   function isQuotaError(err: unknown): boolean  // SDK ApiError의 status === 429, 또는 메시지에 "RESOURCE_EXHAUSTED" / "429"
   ```
2. `generateJson`의 catch: 쿼터 에러면 **즉시 `GeminiQuotaError` throw** (재시도 루프 탈출). 그 외 에러는 기존 1회 재시도 유지.

> 참고: 현재 실제 모델은 `lib/gemini.ts:9`의 `gemini-flash-lite-latest`다 (`-latest` 별칭으로 버전 은퇴에 대비). 이 단계에서 모델은 건드리지 않는다.

## 3. `lib/lifecycle.ts`(신규) + `lib/detect.ts` + `lib/insights.ts`

### 3.1 `lib/lifecycle.ts` (신규) — 자동 stale (P1)

```ts
const STALE_AFTER_DAYS = { weekly: 14, monthly: 60, yearly: 730 }; // 2× cadence — lib/insights.ts의 CADENCE_DAYS와 동일 기준
export async function applyStaleStatus(userId: string, now = new Date()): Promise<number>
```

cadence별 `updateMany` 3회, 바뀐 행 수의 합을 반환:

```ts
where: { userId, status: "active", isManual: false, cadence, lastCharged: { lt: cutoff } }
data:  { status: "stale" }
```

> ⚠️ **`isManual: false`는 필수다.** 수동 추가 구독은 생성 시 `lastCharged: now`가 박히고 이후 갱신되는 트랜잭션이 없다(`app/api/subscriptions/route.ts`). 이 조건을 빠뜨리면 사용자가 손으로 넣은 구독이 2× cadence 후 **전부 stale로 사라진다.** 이 계획에서 가장 위험한 디테일.

호출 위치 두 곳:
- `detectSubscriptions` 끝 (Stage B 이후 — revive된 구독이 같은 패스에서 올바르게 정리되도록) → `staleMarked`에 반영
- 대시보드 로드 시 (`app/page.tsx`, 쿼리 전). write-on-read지만 인덱스 걸린 저렴한 `updateMany`이고 페이지가 이미 `force-dynamic`이라 허용. 감지 실행 때만 하면 재업로드를 안 하는 사용자의 상태가 영영 고정되므로 이쪽이 낫다.

### 3.2 `lib/detect.ts` — 구조화된 결과 (P5)

`DetectionSummary` 확장:

```ts
{
  candidates: number;
  merchantsAnalyzed: number;
  merchantsPending: number;   // 이번 실행 후에도 미분석으로 남은 가맹점 수
  quotaExhausted: boolean;    // 배치가 GeminiQuotaError를 맞음
  staleMarked: number;        // 이번 실행에서 자동 stale 처리된 구독 수
  subscriptions: DetectedSubscription[];
}
```

`enrichMerchants`의 silent catch(110-113행) 교체:

```ts
} catch (err) {
  if (err instanceof GeminiQuotaError) { quotaExhausted = true; break; } // 남은 배치도 어차피 실패
  continue;
}
```

`merchantsPending = missing.length - merchantsAnalyzed` (성공한 배치가 일부 키를 안 돌려준 경우도 함께 집계됨). 둘 다 `detectSubscriptions`까지 올린다.

### 3.3 `lib/detect.ts` Stage B(198-213행) — 상태 정책 정리 (P1, P3)

현재는 `rejected`만 skip하고 `cancelled`는 데이터가 갱신된다(의도치 않은 동작). 이를 **의도된 정책으로 명문화**하고 주석을 남긴다:

- `rejected` → `continue` (기존 유지, 사용자 판단 존중)
- `stale`이고 기존보다 새로운 청구가 발견됨 → **자동 revive** (`status: "active"`)
- `cancelled` → 청구 데이터는 갱신하되 **auto-revive 안 함** ("해지했는데 아직 청구되고 있다"를 보여주는 게 오히려 유용)
- `existing.userEdited === true` → `amount`/`cadence`는 보존, `lastCharged`/`firstSeen`만 갱신, `nextBillingEstimate`는 `nextBilling(cand.lastCharged, existing.cadence as SubscriptionCadence)`로 **사용자 cadence 기준** 재계산

### 3.4 `lib/insights.ts`

- 합계는 계속 `status: "active"`만 집계 → stale이 자동으로 빠진다 (**의도된 숫자 변화**; 기존 시드 데이터가 있으면 대시보드 총액이 줄어드는 게 정상)
- 기존의 시간 계산식 stale advisory(87-99행)를 `status: "stale"` 조회로 교체 → stale의 정의를 DB 한 곳으로 통일

## 4. API

### 4.1 `app/api/subscriptions/[id]/route.ts` — PATCH 확장 (P3)

`PatchBody`를 `{ status?, note?, name?, amount?, cadence?, category?, nextBillingEstimate? }`로 확장.

- `VALID_STATUS`는 `active | cancelled | rejected` 유지 — **`stale`은 사용자가 설정 불가**. stale 구독을 `active`로 PATCH하는 것이 곧 Reactivate/Undo 경로이며 이미 동작한다.
- 검증: `amount`는 양의 유한수, `cadence`는 weekly/monthly/yearly, `nextBillingEstimate`는 파싱 가능한 날짜(`new Date(v)`로 저장), `category`는 `MERCHANT_CATEGORIES`(`lib/categories.ts`) 내 값
- `amount | cadence | nextBillingEstimate` 중 하나라도 오면 update data에 `userEdited: true` 포함
- `cadence`만 바뀌고 `nextBillingEstimate`가 없으면 `nextBilling(existing.lastCharged, cadence)`로 재계산
- `category`는 `name`과 같이 **Merchant 행**에 기록(`prisma.merchant.update`). 감지는 기존 merchant를 갱신하지 않으므로 플래그 불필요

### 4.2 `app/api/detect/route.ts`

새 필드는 그대로 통과. 에러 fallback 객체(22-29행)에 `merchantsPending: 0, quotaExhausted: false, staleMarked: 0` 추가하고, 잡힌 에러가 `GeminiQuotaError`면 `quotaExhausted: true`로 내려준다.

### 4.3 신규 라우트

`middleware.ts`의 matcher가 이미 이 경로들을 보호하므로 matcher 변경 불필요.

| 라우트 | 동작 |
|---|---|
| `app/api/account/route.ts` `DELETE` | `getUserId()` 가드 → `prisma.user.delete({ where: { id: userId } })` (스키마 cascade가 Upload/Transaction/Merchant/Subscription/Insight 정리) → `{ ok: true }`. 클라이언트가 이어서 `signOut` |
| `app/api/account/password/route.ts` `POST` | `{ currentPassword, newPassword }` → 세션 가드 → `bcrypt.compare`(불일치 401/400) → `newPassword.length >= 8` 검증(signup과 동일 규칙, `app/api/signup/route.ts:27`) → `bcrypt.hash(new, 10)` 저장 |
| `app/api/export/route.ts` `GET ?format=json\|csv` | json: `{ exportedAt, subscriptions[], transactions[] }` 단일 문서 / csv: transactions (`date,description,merchant,category,amount,isSubscription`). 둘 다 `Content-Disposition: attachment`. CSV 이스케이프는 로컬 소형 함수 — **신규 의존성 없음** |

## 5. 대시보드 (`app/page.tsx`)

1. **due-soon 버그 수정 (P2)** — 71-73행 교체:
   ```ts
   const days = (d: Date) => (d.getTime() - now) / (24 * 60 * 60 * 1000);
   const dueSoon = (d: Date) => days(d) >= 0 && days(d) <= DUE_SOON_DAYS;
   const overdue = (d: Date) => days(d) < 0;
   ```
   과거 날짜에는 `overdue` 배지(rose 계열, 176행의 amber "due soon" 배지 스타일 미러링). 많이 밀린 구독은 대개 이미 자동 stale이므로 overdue는 "추정일이 조금 밀린" 구간만 뜬다.
2. 쿼리 전에 `applyStaleStatus(userId)` 호출
3. **stale 배너**: `subscription.count({ where: { userId, status: "stale" } })` > 0이면 amber 배너 "N subscriptions look inactive — review" → `/subscriptions?status=stale` 링크
4. **재감지 배너 (P5)**: `transaction.count({ where: { userId, merchantId: null } })` > 0이면 "N transactions haven't been AI-labeled yet" + 신규 `components/rerun-detection.tsx` — POST `/api/detect` → busy 상태 → `router.refresh()`; 응답이 `quotaExhausted`면 배너를 지우지 말고 쿼터 안내를 인라인 표시
5. **Upcoming renewals 섹션 (P8)** — 별도 `/renewals` 페이지가 아니라 대시보드 섹션으로 간다 (대시보드가 이미 `nextBillingEstimate` 순 정렬 리스트를 갖고 있어 페이지를 나누면 중복이고, 사이드바가 7개로 과밀해진다):
   - 신규 `lib/renewals.ts`의 순수 함수 `groupUpcoming(subs, now)` → `0 <= days(next) <= 30`을 `{ thisWeek, nextWeek, laterThisMonth }`로 버킷 + `dueNext30Days` 합계(월 환산이 아닌 **실제 청구 금액**)
   - "Active subscriptions" 위에 섹션 렌더, 빈 그룹은 스킵, 기존 행 Card 마크업 재사용
   - 가치가 낮은 "Categories" StatCard(116행)를 **"Due in next 30 days"**로 교체 *(되돌리기 쉬운 결정)*

## 6. `/subscriptions` 목록 페이지 (신규) — P4

`app/subscriptions/page.tsx` (server component, `force-dynamic`, `searchParams: Promise<{ status?: string }>` — 저장소의 Next 16 관례):

- 상태 탭 **Active / Stale / Cancelled / Rejected** (기본 `active`), `<Link href="/subscriptions?status=...">` pill + `groupBy({ by: ["status"], where: { userId }, _count: true })`로 탭별 카운트
- 행은 대시보드 카드 스타일 재사용: 이름, `CategoryBadge`, 상태 배지(**stale은 amber 추가**), 금액/주기. 보조 줄은 active면 `next {date}`, 아니면 `last charged {date}`
- 행 전체가 `/subscriptions/[id]` 링크 — detail 라우트가 이미 그 경로에 있어 자연스럽게 중첩되고, 사이드바의 `startsWith` active 표시도 그대로 맞는다
- 비활성 탭에는 신규 `components/subscription-quick-actions.tsx`의 **Reactivate** 버튼 하나만 (PATCH `{ status: "active" }` + `router.refresh()`). 나머지 작업은 detail에 둔다. 버튼은 `<Link>` 바깥에 두거나 핸들러에서 `e.preventDefault()` — 앵커 중첩 주의
- `components/sidebar.tsx`의 NAV(8행)에 `{ href: "/subscriptions", label: "Subscriptions", icon: "layers" }`를 Dashboard와 Transactions 사이에 추가 + 아이콘 케이스 추가
- detail 페이지(`app/subscriptions/[id]/page.tsx`): `statusStyle`(70행)에 `stale` 추가 + stale일 때 "자동으로 비활성 처리됨 — {lastCharged} 이후 청구 없음" 힌트

## 7. 전체 편집 UI (`components/subscription-actions.tsx`) — P3

props에 `amount: number`, `cadence: string`, `category: string`, `nextBillingEstimate: string(ISO)`, `userEdited: boolean` 추가. 편집 분기에 입력 추가:

- 금액: `<input type="number" step="0.01" min="0">`
- 주기: `<select>` weekly/monthly/yearly
- 카테고리: `<select>` over `MERCHANT_CATEGORIES`
- 다음 결제일: `<input type="date">` (value는 ISO date slice)

저장 시 **바뀐 필드만** PATCH 바디에 담는다 (서버가 실제 변경 시에만 `userEdited`를 세우도록). `userEdited`면 "edited manually — detection won't overwrite amount/cadence" 캡션 표시. `app/subscriptions/[id]/page.tsx:148` 호출부에 새 props 전달. 기존 `status === "active" ? cancel : reactivate` 삼항(102행)은 stale에서 Reactivate를 내주므로 그대로 맞다.

## 8. 업로드 플로우 (`app/upload/page.tsx`) — P5

1. 로컬 `Detection` 인터페이스(46행)에 `merchantsPending?: number; quotaExhausted?: boolean` 추가 (에러 fallback을 허용하려 optional), 241행 catch fallback도 갱신
2. "done" 카드의 기존 `detection?.error` 블록(421행 근처) 옆에: `quotaExhausted || merchantsPending > 0`이면 amber 경고 — *"AI quota exceeded — {merchantsPending} merchant(s) not analyzed yet. Your transactions are saved; re-run detection later from the dashboard."* + §5.4의 `RerunDetection` 버튼 재사용
3. **Undo reject**: 감지 리스트(470행)에서 `rejected.has(s.id)`인 행의 버튼을 **Undo**로 바꿔 PATCH `{ status: "active" }` + `rejected` Set에서 제거. 인라인으로 충분 — 토스트 라이브러리 불필요

## 9. Transactions 검색/필터/페이지네이션 (`app/transactions/page.tsx`) — P7

server component 유지, `searchParams: Promise<{ q?, category?, month?, page? }>`.

```ts
const PAGE_SIZE = 50;
const where: Prisma.TransactionWhereInput = {
  userId,
  ...(q ? { OR: [
      { rawDescription: { contains: q, mode: "insensitive" } },
      { merchant: { normalizedName: { contains: q, mode: "insensitive" } } },
    ] } : {}),
  ...(category ? { merchant: { category } } : {}),
  ...(month ? { date: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } } : {}),
};
const [total, transactions] = await Promise.all([
  prisma.transaction.count({ where }),
  prisma.transaction.findMany({ where, orderBy: { date: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { ... } }),
]);
```

- `page`는 1 이상으로 clamp. 마지막 페이지를 넘어가면 빈 리스트 + 페이지네이션 바 (크래시 금지)
- "Total spend" StatCard는 `aggregate({ where, _sum: { amount } })` — 페이지가 아니라 **필터 전체**를 반영
- 전체 건수가 0일 때만 기존 빈 상태. 필터 결과가 0이면 "No transactions match your filters" + 필터 해제 링크
- 신규 `components/transaction-filters.tsx` (client): 검색 입력(~300ms 디바운스), 카테고리 `<select>`(`MERCHANT_CATEGORIES` + "All"), `<input type="month">`, Clear 버튼. `useRouter` + `useSearchParams`로 `router.replace`, **필터 변경 시 `page` 파라미터 삭제**
- 페이지네이션은 페이지 자체에서 서버 렌더: 현재 파라미터를 유지하는 Prev / `Page X of Y` / Next `<Link>` (`URLSearchParams`로 조립). 클라이언트 상태 불필요

## 10. 라우트 레벨 상태 (신규) — P6

- `components/skeletons.tsx` (server-safe): `Skeleton`(`animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800`) + `components/ui.tsx`의 Card/StatCard 형태에 맞춘 `StatGridSkeleton`, `ListSkeleton`
- `app/loading.tsx`: PageHeader 형태 + 4-스탯 그리드 + 리스트 스켈레톤. **전역 하나로 충분** (모든 라우트가 레이아웃 셸과 형태를 공유). 라우트별 파일은 선택적 폴리시이며 계획에 포함하지 않음
- `app/error.tsx`: `"use client"`, `({ error, reset })`, Card 스타일 "Something went wrong" + `error.message` + `reset()` 버튼 + 홈 링크. 업로드 에러 카드의 rose 스타일 미러링
- `app/not-found.tsx`: `components/brand`의 `BrandMark` + "Page not found" + 대시보드 링크. detail 페이지의 `notFound()`(59행)도 이걸 탄다

## 11. `/settings` (신규) — P8

`app/settings/page.tsx` (server component, `getUserId` 가드, 이메일 + 내보내기 안내용 카운트 조회) + 신규 `components/settings/` 하위 client 컴포넌트 3개:

1. `change-password-form.tsx` — current/new/confirm 필드, POST `/api/account/password`, 인라인 성공/실패. signup과 동일한 min-8 클라이언트 검증
2. `export-data.tsx` — `<a href="/api/export?format=json">` / `?format=csv` 다운로드 링크 2개 (JS 불필요)
3. `delete-account.tsx` — 접힌 "Delete account" 위험 카드 → 펼치면 `delete`(또는 이메일) 타이핑을 요구해야 버튼 활성 → DELETE `/api/account` → `signOut({ callbackUrl: "/login" })` (`next-auth/react`, 사이드바 5행과 동일)

사이드바 NAV에 `{ href: "/settings", label: "Settings", icon: "gear" }` 추가.

## 12. 작업 순서

| # | 단계 | 선행 |
|---|---|---|
| 1 | 스키마(`stale` 주석, `userEdited`) + `npm run db:push` | — |
| 2 | `lib/gemini.ts` 쿼터 에러 | — |
| 3 | `lib/lifecycle.ts` + `lib/detect.ts`(구조화 결과, revive, userEdited 존중) + `lib/insights.ts` stale 조회 | 1, 2 |
| 4 | API: PATCH 확장, detect fallback, `account` / `account/password` / `export` | 1 |
| 5 | 대시보드: due-soon 수정, applyStale 호출, stale·rerun 배너, renewals 섹션 + `lib/renewals.ts` | 3 |
| 6 | `/subscriptions` 페이지 + quick actions + 사이드바 + detail stale 배지 | 1, 4 |
| 7 | `subscription-actions.tsx` 전체 편집 + detail props | 4 |
| 8 | 업로드: 쿼터 경고 + Undo reject | 3, 5(컴포넌트) |
| 9 | Transactions 필터/페이지네이션 + `transaction-filters.tsx` | — |
| 10 | `loading.tsx` / `error.tsx` / `not-found.tsx` + `skeletons.tsx` | — |
| 11 | `/settings` + 컴포넌트 + 사이드바 | 4 |
| 12 | 검증 | 전부 |

9–11은 1–8과 독립이라 순서를 바꿔도 된다.

## 13. 검증 (Gemini 쿼터 소모 없음)

1. `npx tsc --noEmit` + `npm run build` 통과
2. `npm run db:seed`(결정적, Gemini 미사용) 후 `npx next dev -p 3939`로 실제 플로우 확인:
   - **대시보드**: 과거 날짜에 "due soon" 없음 / overdue 배지 / 시드에 오래된 청구가 있으면 stale 배너가 뜨고 합계에서 빠짐 / "Due in next 30 days" 값이 합리적
   - **`/subscriptions`**: 탭 카운트 일치, stale 행 Reactivate → Active 탭으로 이동, 행 클릭 → detail
   - **detail 편집**: amount/cadence/category/next-billing 저장·유지, `userEdited` 캡션 표시 → 이어서 "Re-run detection" 실행(시드 merchant는 전부 캐시되어 **Gemini 호출 0회**) → 편집한 amount/cadence가 살아남는지 확인
   - **reject → Undo**로 active 복구
   - **Transactions**: 검색어·카테고리·월·2페이지가 전부 URL로 왕복, 필터된 total spend 갱신, 빈 필터 상태 렌더
   - **라우트 상태**: `/subscriptions/nope` → 브랜드 404, 내비게이션 시 스켈레톤
   - **Settings**: 비번 변경 후 새 비번으로 재로그인 / JSON·CSV 내보내기 열어서 시드 데이터 확인 / 스크래치 계정 삭제 → 로그인으로 리다이렉트되고 이후 로그인 실패
   - **쿼터 경로 (실 호출 없이)**: `GEMINI_API_KEY`를 잠시 비우고 **새 가맹점**이 든 작은 CSV 업로드 → 임포트는 성공, done 화면에 "not analyzed yet" 경고 + rerun 버튼 (`getClient`가 throw → 배치가 비쿼터 실패로 잡힘 → `merchantsPending > 0`)

## 14. 리스크 (결정과 근거)

- **stale을 저장 status로 둘 것인가 vs 조회 시 파생할 것인가** — 저장을 택했다. 구독이 active 합계에서 눈에 보이게 빠지고 탭이 단순 쿼리로 동작하며, 사용자가 설정할 수 없으므로 의도 충돌이 불가능하다. revive는 detect가 처리.
- **자동 stale에서 수동 구독 제외(`isManual: false`)** — 이 계획 최대의 정확성 함정. 누락 시 수동 구독 전멸.
- **대시보드 write-on-read**(로드마다 `applyStaleStatus`) — 인덱스 걸린 저렴한 `updateMany`. 신선도를 위해 감수. 거슬리면 나중에 하루 1회로 게이팅.
- **cancelled는 청구 데이터가 갱신되지만 auto-revive는 안 됨** — 현재의 우발적 동작을 대체하는 **의도된 정책**. `detect.ts`에 주석 필수.
- **단일 `userEdited` 플래그** — 손으로 넣은 `nextBillingEstimate`는 새 청구 발생 시 `lastCharged + 사용자 cadence`로 재계산된다. 허용; 문제가 되면 필드별 플래그로.
- **계정 삭제 후 JWT 쿠키는 `signOut` 전까지 유효** — 모든 쿼리가 존재하지 않는 userId로 스코프되어 무해.
