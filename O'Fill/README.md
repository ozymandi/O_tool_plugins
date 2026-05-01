# O'Fill

CEP-плагін для Adobe Illustrator. Заповнює container-shape копіями donor-об'єктів через turbo-grid колізію. Порт `O'Tool/O'Fill.jsx` (v9) з новим stack-based workflow.

## Workflow (відрізняється від оригіналу)

1. **Виділіть shape** на artboard (контейнер для заповнення)
2. **`SELECT SHAPE`** — плагін захоплює його, переходить в ACTIVE
3. **Виділіть один або більше донорів** → **`+ ADD TO STACK`**
4. У стеку: drag-handle для зміни порядку (важливо для gradient mode), `✕` для видалення
5. Налаштуйте параметри
6. **`GENERATE`** — створюється preview group `OFILL_PREVIEW_FINAL`. Натискайте скільки разів треба — кожен раз новий random.
7. **`APPLY`** коммітить (опційно з clipping mask) → IDLE. Або **`CANCEL`** — видаляє preview і скидає сесію.

## Параметри

- **Fill amount %** — який відсоток container заповнювати (по осі залежно від Origin)
- **Gap (px)** — мінімальна відстань між елементами
- **Attempts (k)** — скільки ітерацій робити (більше = щільніше, повільніше)
- **Min/Max scale %** — діапазон розміру donors
- **Origin** — звідки рости градієнтом: BOTTOM UP / TOP DOWN / LEFT→RIGHT / RIGHT→LEFT
- **MIX mode** — замість gradient рандомно мішає donors
- **Random rotation** — кожен donor під випадковим кутом
- **Clipping mask** — після APPLY обмежити preview формою container

## Чому немає live preview

Turbo-fill з 30k+ ітерацій + grid hashing + symbol placement коштує 1-3 секунди на середньому контейнері. Real-time оновлення на кожен слайдер вбило б Illustrator. Manual GENERATE дає контроль і передбачуваність — як в оригінальному скрипті.

## Розробка

```powershell
.\install.ps1 -EnableDebugMode
.\uninstall.ps1
```

## Збірка ZXP

```powershell
.\build-zxp.ps1 -SignToolPath "<ZXPSignCmd.exe>" -CertPath "<cert.p12>" -CertPassword "<password>"
```
