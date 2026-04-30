# O'Split

CEP-плагін для Adobe Illustrator. Розщеплює текстові фрейми на окремі об'єкти за рівнем — параграфи, рядки, слова або символи.

## Технологія "Relative Lift Isolation"

При вимірюванні позиції шматка тексту скрипт:
1. Дублює фрейм
2. Піднімає весь текст на +10000pt по baselineShift, ховає колір
3. Опускає лише цільовий шматок назад
4. Робить outline і вимірює реальні границі видимих контурів ("Earth cluster")

Це дає точну фізичну позицію навіть для кернінгу, накладених літер, baseline shift тощо.

## Як працює

1. Виділіть один або кілька текстових фреймів
2. Натисніть один з 4 режимів:
   - **PARAGRAPHS** — на параграфи (зберігає area-text bounds)
   - **LINES** — на видимі рядки
   - **WORDS** — на слова
   - **CHARACTERS** — на символи
3. **Keep original** — оригінал ховається, не видаляється

## Розробка

```powershell
.\install.ps1 -EnableDebugMode
.\uninstall.ps1
```

## Збірка ZXP

```powershell
.\build-zxp.ps1 -SignToolPath "<ZXPSignCmd.exe>" -CertPath "<cert.p12>" -CertPassword "<password>"
```
