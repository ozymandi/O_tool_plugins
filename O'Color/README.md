# O'Color

CEP-плагін для Adobe Illustrator. Випадковий колір з обраних swatches на виділені об'єкти. Порт з `O'Tool/O'Color.jsx` (Random Color Pro).

## Як працює

1. Відкрийте `Window > Swatches`, виділіть **2+ swatches** (Shift+click або Ctrl+click)
2. На artboard виберіть об'єкти, які треба перефарбувати
3. У плагіні: натисніть `CHECK SWATCHES` щоб переконатись що ви виділили колір (буде показано лічильник)
4. Виберіть `Fill`, `Stroke` або обидва
5. `RANDOMIZE` — кожен об'єкт незалежно отримує випадковий колір з вашого набору

Скрипт рекурсивно проходить групи, для compound path фарбує перший шлях (як в Illustrator), для text frames застосовує fill/stroke напряму.

Кожне натискання `RANDOMIZE` дає нову розкладку — клацніть кілька разів щоб знайти бажаний варіант.

## Розробка

```powershell
.\install.ps1 -EnableDebugMode
.\uninstall.ps1
```

## Збірка ZXP

```powershell
.\build-zxp.ps1 -SignToolPath "<ZXPSignCmd.exe>" -CertPath "<cert.p12>" -CertPassword "<password>"
```
