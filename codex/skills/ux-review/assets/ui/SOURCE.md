# 출처

HerdRabbit(`ultivis-iot/HerdRabbit`)의 `public/ui/`에서 가져온 공통 UI 킷입니다.

- 원본 커밋: `a2d32ed` (2026-09-08) — feat: 터미널 WebSocket 전환 및 공통 HTML UI 분리
- 가져온 파일: `ui.css`, `tokens.css`, `base.css`, `components.css`

예제 전용 파일(`index.html`, `examples.css`, `examples.js`)과 앱 전용 스타일(`styles.css`)은
제품 배포에서 제외해도 된다고 원본 README가 밝히고 있어 가져오지 않았습니다.

## 갱신

원본이 바뀌면 네 파일을 다시 복사하면 됩니다. 빌드나 npm 의존성은 없습니다.

```bash
cp /path/to/HerdRabbit/public/ui/{ui,tokens,base,components}.css assets/ui/
```

뷰어 고유 스타일은 `assets/viewer-page.html`의 `<style>` 안에 있고, 이 폴더의 CSS 뒤에
로드되므로 여기 파일을 직접 고치지 마세요. 색이나 간격을 바꾸려면 그 `<style>`에서
변수를 재정의합니다.
