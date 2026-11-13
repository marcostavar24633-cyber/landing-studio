# Подключение

## Обычный CSS / HTML
Импортировать в таком порядке:
```css
@import "./design-system/tokens.css";
@import "./design-system/components.css";
```

## React + Vite
Скопировать папку `design-system` в проект и импортировать файлы в главный CSS:
```ts
import "./design-system/tokens.css";
import "./design-system/components.css";
```

## Профиль бренда
В отдельном файле проекта переопределить семантические переменные:
```css
:root {
  --ds-bg: #171a18;
  --ds-surface: #202520;
  --ds-text: #f4f1eb;
  --ds-accent: #c7a477;
  --ds-accent-contrast: #171a18;
  --ds-font-body: "Manrope", sans-serif;
  --ds-font-display: "Cormorant Garamond", serif;
}
```
Значения выше — пример профиля, не универсальные настройки для всех брендов. Перед переносом в проект сверять с его текущим дизайном.
