# O'Tool Plugins for Adobe Illustrator

CEP-плагіни для Adobe Illustrator 2026, конвертовані зі скриптів `O'Tool`.

## Структура

Кожен плагін — окрема папка з повною CEP-структурою:

```
PluginName/
├── CSXS/manifest.xml
├── index.html
├── css/main.css
├── js/main.js
├── host/index.jsx
├── icons/
├── build-zxp.ps1
├── install.ps1
└── uninstall.ps1
```

## Дизайн-система

Темна CEP-панель, базується на еталоні `O'Zometrix`:
- Палітра: `#1e1e1e` фон, `#2c2c2c` панель, `#18a0fb` акцент
- Типографіка: Segoe UI 11px
- Контроли: 24px висота, segmented buttons, slider-capsule, custom dropdown
- Радіуси: 4px controls, 6px surface, 8px shell

## Список плагінів

- [x] O'Deselect
- [x] O'Select
- [x] O'Trim
- [x] O'Split
- [x] O'Connect
- [x] O'Align
- [x] O'Fit
- [x] O'Bend
- [x] O'Bevel
- [x] O'Color
- [x] O'Fill
- [x] O'Cone
- [x] O'Spiral
- [ ] O'Line
- [ ] O'GridScale
- [ ] O'Linearray
- [ ] O'Autoshape
- [ ] O'Math
- [ ] O'Vertex
- [ ] O'Voron
- [ ] O'Symbol
- [ ] O'Text
- [ ] O'Atractor
- [ ] O'Fractal
- [ ] O'Nebula
- [ ] O'Scatter
- [ ] O'Scatter_Symbol
- [ ] O'BakeUI
- [ ] O'Replace_Color
- [ ] O'Replace_Light
- [ ] O'LumeGradient
- [ ] O'Zometrix (вже існує як референс)
- [ ] O'GridGen (вже існує як референс)
