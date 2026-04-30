# O'Select

CEP-плагін для Adobe Illustrator. Замінює виділення з контейнерів (груп, compound shapes) на саме листя — об'єкти всередині, які можна перефарбувати.

## Як працює

Плагін рекурсивно проходить виділені групи та контейнери і збирає всі "leaf"-об'єкти, типи яких увімкнені в секції **Include**. Потім скидає виділення і виділяє знайдені об'єкти.

**Include** — типи об'єктів, які потрапляють у виділення:
- Paths, Compound paths, Text frames (стандартно)
- Raster images, Mesh items, Placed / Linked (опційно)

**Skip** — що пропустити при обході:
- Clipping paths (зазвичай невидимі обрізні маски)
- Hidden items
- Locked items

## Розробка

```powershell
.\install.ps1 -EnableDebugMode
.\uninstall.ps1
```

Перезапустіть Illustrator після інсталяції. Панель: `Window > Extensions > O'Select`.

## Збірка ZXP

```powershell
.\build-zxp.ps1 -SignToolPath "<path-to-ZXPSignCmd.exe>" -CertPath "<path-to-cert.p12>" -CertPassword "<password>"
```
