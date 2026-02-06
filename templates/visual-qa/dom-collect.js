// visual-qa Phase 5-3: 디자인 분석용 DOM 데이터 수집
// javascript_tool 단일 호출로 6개 항목을 한 번에 수집
// 반환: { buttons, spacing, typography, colors, infoStructure, stateHandling }
(() => {
  const gs = el => getComputedStyle(el);

  // 1. 버튼 스타일
  const buttons = [...document.querySelectorAll('button, [role="button"]')];
  const btnStyles = buttons.map(b => {
    const s = gs(b);
    return { bg: s.backgroundColor, font: s.fontSize, radius: s.borderRadius, padding: s.padding };
  });
  const buttonData = { buttonCount: buttons.length, uniqueStyles: [...new Set(btnStyles.map(JSON.stringify))].length };

  // 2. 간격/정렬
  const containers = [...document.querySelectorAll('[class*="container"], [class*="wrapper"], [class*="section"], main, aside')];
  const spacingData = containers.slice(0, 10).map(el => {
    const s = gs(el);
    return { tag: el.tagName, padding: s.padding, margin: s.margin, gap: s.gap };
  });

  // 3. 타이포그래피
  const textEls = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,label,td,th')].slice(0, 30);
  const typo = textEls.map(el => {
    const s = gs(el);
    return { tag: el.tagName, size: s.fontSize, weight: s.fontWeight, lineHeight: s.lineHeight, family: s.fontFamily.split(',')[0] };
  });
  const typographyData = { sizes: [...new Set(typo.map(t => t.size))].sort(), families: [...new Set(typo.map(t => t.family))], sampleCount: typo.length };

  // 4. 색상
  const colorMap = {};
  [...document.querySelectorAll('*')].slice(0, 200).forEach(el => {
    const s = gs(el);
    [s.color, s.backgroundColor].forEach(c => {
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') colorMap[c] = (colorMap[c] || 0) + 1;
    });
  });
  const colorData = Object.entries(colorMap).sort((a, b) => b[1] - a[1]).slice(0, 15);

  // 5. 정보 구조
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({ tag: h.tagName, text: h.textContent?.trim().slice(0, 50) }));
  const breadcrumb = document.querySelector('[class*="breadcrumb"], [aria-label="breadcrumb"], nav ol, nav [class*="Breadcrumb"]');
  const mainActions = [...document.querySelectorAll('button, [role="button"]')].filter(b => {
    const rect = b.getBoundingClientRect();
    return rect.top < 200 && rect.width > 60;
  }).map(b => b.textContent?.trim().slice(0, 30));
  const infoData = { headings, hasBreadcrumb: !!breadcrumb, topActions: mainActions };

  // 6. 상태 처리
  const emptyState = document.querySelector('[class*="empty"], [class*="Empty"], [class*="no-data"], [class*="NoData"], [class*="placeholder"]');
  const skeleton = document.querySelector('[class*="skeleton"], [class*="Skeleton"], [class*="shimmer"]');
  const errorMsg = document.querySelector('[class*="error-message"], [class*="ErrorMessage"], [role="alert"]');
  const focusable = [...document.querySelectorAll('button, a, input, select, textarea')].slice(0, 5);
  const hasOutline = focusable.some(el => { el.focus(); return gs(el).outlineStyle !== 'none'; });
  const stateData = { hasEmptyState: !!emptyState, hasSkeleton: !!skeleton, hasErrorMsg: !!errorMsg, hasFocusOutline: hasOutline };

  return JSON.stringify({ buttons: buttonData, spacing: spacingData, typography: typographyData, colors: colorData, infoStructure: infoData, stateHandling: stateData });
})()
