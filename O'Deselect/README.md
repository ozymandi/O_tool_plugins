# O'Deselect

CEP-плагін для Adobe Illustrator. Розріджує існуючу виділення за шаблоном (sequence) або випадково (random).

## Як працює

- **Sequence** — повторює патерн `Selected / Unselected` зі зсувом `Offset` по виділених об'єктах.
- **Random** — кожен об'єкт залишається виділеним з імовірністю `Probability %`.

Якщо виділено один `PathItem` — операція працює над опорними точками, інакше — над об'єктами.

- `APPLY` — застосовує патерн до поточного виділення
- `SAVE SELECTION` — застосовує патерн і відкриває нативний діалог Illustrator "Save Selection..."

Скасування — через `Ctrl+Z` в Illustrator.

## Розробка

```powershell
# Установка плагіна в CEP-теку (вимагає PlayerDebugMode = 1)
.\install.ps1 -EnableDebugMode

# Видалення
.\uninstall.ps1
```

Після `install.ps1 -EnableDebugMode` перезапустіть Illustrator. Панель з'явиться в меню `Window > Extensions > O'Deselect`.

## Збірка ZXP

```powershell
.\build-zxp.ps1 -SignToolPath "<path-to-ZXPSignCmd.exe>" -CertPath "<path-to-cert.p12>" -CertPassword "<password>"
```
