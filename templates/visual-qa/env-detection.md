# 환경 감지 절차

## 프레임워크 감지

`package.json`을 읽어 프레임워크를 판별합니다:

- `dependencies` 또는 `devDependencies`에 `vite` → **Vite**
- `dependencies`에 `@remix-run/react` 또는 `remix` → **Remix**
- `dependencies`에 `react-scripts` → **CRA**
- 그 외 `dependencies`에 `react` → **React (기타)**

모노레포인 경우 (`workspaces` 필드 존재 또는 `packages/` 디렉토리 존재):
- `packages/frontend/package.json` 또는 프론트엔드 패키지를 찾아 판별

## 개발 서버 URL 감지

우선순위대로 확인하여 **첫 번째 성공한 것**을 사용:

1. **인자로 URL 지정된 경우**: `--url` 값 사용
2. **Docker 컨테이너 확인**:
   ```bash
   docker compose ps --format json 2>/dev/null || docker ps --format json 2>/dev/null
   ```
   실행 중인 컨테이너에서 프론트엔드 포트 매핑(5173, 3000, 3001, 8080) 확인
3. **로컬 리스닝 포트 확인** (플랫폼별 분기):
   ```bash
   # Linux
   ss -tlnp 2>/dev/null | grep -E ':(5173|3000|3001|8080|4173)\s'
   # macOS (ss 미지원)
   lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null | grep -E ':(5173|3000|3001|8080|4173)\s'
   ```
   플랫폼 판별: `uname -s` 결과가 `Darwin`이면 macOS, 그 외 Linux
4. **설정 파일 확인**: `vite.config.*`에서 `server.port`, `.env`에서 `PORT` 변수
5. **프레임워크별 기본값**: Vite→5173, CRA→3000

감지된 URL에 HTTP 요청으로 응답 확인:
```bash
curl -s -o /dev/null -w "%{http_code}" <url> --max-time 3
```
응답이 없으면 사용자에게 안내하고 URL 입력을 요청합니다.

## 라우트 설정 파일 탐색

**React Router (Vite/CRA/기타)**:
```
Glob: **/routes.{jsx,tsx,js,ts}
Glob: **/router.{jsx,tsx,js,ts}
Glob: **/App.{jsx,tsx,js,ts}
```

**Remix** (`app/routes/` 디렉토리 존재 시):
```
Glob: app/routes/**/*.{jsx,tsx,js,ts}
```

`node_modules`, `dist`, `build` 디렉토리는 제외합니다.

## 라우트 파싱

### React Router (Vite/CRA/기타)
- `<Route path="..." component={...} />` 또는 `element={<.../>}` 패턴
- `{ path: '...', element: ... }` 객체 패턴 (react-router v6 config)
- 중첩 라우트의 경우 부모+자식 path를 결합

### Remix
파일명 규칙을 경로로 변환:
- `app/routes/_index.tsx` → `/`
- `app/routes/companies.tsx` → `/companies`
- `app/routes/companies.$id.tsx` → `/companies/:id`
- dot(`.`)을 slash(`/`)로 변환, `$param`을 `:param`으로 변환
- `_`로 시작하는 세그먼트는 pathless layout으로 경로에서 제외
