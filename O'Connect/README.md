# O'Connect

CEP-плагін для Adobe Illustrator. З'єднує виділені об'єкти ("дітей") з центральним "Hub" гладкими безьє-кривими — для діаграм, mind-maps, UI-flowcharts.

## Як працює

1. Принесіть **Hub-об'єкт на передній план** (`Object > Arrange > Bring to Front` або `Ctrl+Shift+]`)
2. Виділіть Hub разом з усіма "дітьми"
3. Натисніть `CONNECT`

Алгоритм:
- Hub = передній об'єкт виділення (`sel[0]`)
- Для кожної дитини рахується кут від центру Hub до центру дитини
- За кутом обирається сторона Hub (Top / Bottom / Left / Right) на основі **Angle threshold** (вузький горизонтальний сектор; решта — вертикальний)
- Малюється безьє з контрольними точками довжиною `distance × Tension`

## Параметри

- **Tension** — кривина (0 = пряма лінія, 0.35 = неоновий діаграмний стиль, 1+ = дуже округло)
- **Angle threshold** — ширина горизонтального Left/Right сектора в градусах. Менше = більше об'єктів підключаються через Top/Bottom
- **Width** — товщина обведення в pt
- **Color** — джерело кольору обведення:
  - `Hub stroke` — успадкувати від Hub якщо це обведений path
  - `Black` — суцільний чорний
  - `First swatch` — перший swatch документу

## Розробка

```powershell
.\install.ps1 -EnableDebugMode
.\uninstall.ps1
```

## Збірка ZXP

```powershell
.\build-zxp.ps1 -SignToolPath "<ZXPSignCmd.exe>" -CertPath "<cert.p12>" -CertPassword "<password>"
```
