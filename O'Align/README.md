# O'Align

CEP-плагін для Adobe Illustrator. Розумно повертає батьківський об'єкт (Group, Compound Path або просто Path) так, щоб дві обрані anchor-точки лежали на горизонталі або вертикалі.

## Як працює

1. Виберіть 2 anchor-точки (Direct Selection / White Arrow) **АБО** виділіть лінію з 2 точками (Pen / Line tool)
2. Натисніть `ALIGN`

Скрипт:
- Знаходить дві точки в виділенні (рекурсивно через групи й compound paths)
- Обчислює кут між ними `atan2(dy, dx)`
- Залежно від `Direction`:
  - **AUTO** — якщо кут ≤45° від горизонталі, вирівнює до горизонталі; інакше до вертикалі
  - **HORIZONTAL** — завжди до горизонталі
  - **VERTICAL** — завжди до вертикалі
- Повертає найвищого не-Layer батька на отриманий кут

## Pivot (точка обертання)

- **CENTER** — bounding-box центр об'єкта (як в оригіналі)
- **FIRST POINT** — перша точка залишається на місці
- **SECOND POINT** — друга точка залишається на місці

## Розробка

```powershell
.\install.ps1 -EnableDebugMode
.\uninstall.ps1
```

## Збірка ZXP

```powershell
.\build-zxp.ps1 -SignToolPath "<ZXPSignCmd.exe>" -CertPath "<cert.p12>" -CertPassword "<password>"
```
