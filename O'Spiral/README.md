# O'Spiral

CEP-плагін для Adobe Illustrator. Будує єдиний spline-спіральний path, що проходить через 2+ виділених кіл (або інших об'єктів — використовується їх центр і півширина/півгрина як радіус витка). Порт `O'Tool/O'Spiral.jsx`.

## Workflow

1. Виділіть **2 або більше кіл** на artboard
2. **`SPIRAL`** — плагін сортує об'єкти top-down → left-right (з толерансом 10pt по вертикалі), будує preview-path, переходить в ACTIVE
3. У ACTIVE крутіть параметри — preview оновлюється наживо
4. **`APPLY`** — preview лишається фінальним. Або **`CANCEL`** — видаляється.

## Параметри

- **Loop Mode**
  - **TOTAL** — Count = загальна кількість витків через всю спіраль
  - **PER SEGMENT** — Count множиться на кількість сегментів між колами
- **Loops Count** — slider 1–200, число до 1000
- **Randomness 0–100** — per-loop випадкове розширення/звуження з затуханням біля кожного key circle (бо envelope = `sin(πt)`)
- **Direction** — CW або CCW

## Особливості

- Stroke color preview успадковується від першого (після сортування) кола; якщо воно без обведення — чорний.
- Noise re-rolls на кожне оновлення (як у оригіналі). Для стабільного результату — randomness=0; щоб знайти "те саме" зерно — CANCEL → SPIRAL.
- Path точки — corner-only (без bezier handles), як в оригіналі.

## Розробка

```powershell
.\install.ps1 -EnableDebugMode
.\uninstall.ps1
```

## Збірка ZXP

```powershell
.\build-zxp.ps1 -SignToolPath "<ZXPSignCmd.exe>" -CertPath "<cert.p12>" -CertPassword "<password>"
```
