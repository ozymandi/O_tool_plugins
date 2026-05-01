# O'Bevel

CEP-плагін для Adobe Illustrator. Робить рівне округлення кутів (filleting) або кастомні bevels на основі профілю з clipboard. Порт з `O'Tool/O'Bevel.jsx` (Corner Master v16).

## Як працює

1. Виберіть один або кілька об'єктів (path / group / compound path; для груп та compound беремо перший path)
2. Обріть **Mode**:
   - **STEPS** — стандартне округлення з заданою кількістю сегментів (1-50)
   - **CUSTOM** — використати скопійований path як bevel-профіль
3. Налаштуйте **Radius** (1-5000)
4. Увімкніть **Live Preview** для миттєвої візуалізації, або просто натисніть `APPLY`

## CUSTOM режим — clipboard profile

1. Намалюйте path, який має бути формою кута (умовно — від (0,0) до (1,0), Y > 0 — над лінією)
2. Скопіюйте його (Ctrl+C)
3. Натисніть `LOAD CLIPBOARD` в плагіні
4. Скрипт пастить, парсить геометрію, нормалізує до одиничної довжини й видаляє тимчасову копію
5. Профіль живе в сесії — можна застосовувати до різних об'єктів без перезавантаження

**Опції CUSTOM:**
- **Flip vertical** — інвертувати Y-координати профілю
- **Straight sides** — обнулити крайні handles, щоб з'єднання з прямими сегментами було ідеально гладким

## Live Preview

Той самий патерн що й в O'Bend:
- Чекбокс ON → захоплює виділення, дублює як preview, ховає оригінали
- Параметри змінюються → preview оновлюється миттєво (через in-flight queue)
- `APPLY` → видаляє оригінали, лишає preview
- `CANCEL` або зняти галку → видаляє preview, повертає оригінали

Без Live Preview — `APPLY` працює як одноразовий bevel на поточному виділенні.

## Розробка

```powershell
.\install.ps1 -EnableDebugMode
.\uninstall.ps1
```

## Збірка ZXP

```powershell
.\build-zxp.ps1 -SignToolPath "<ZXPSignCmd.exe>" -CertPath "<cert.p12>" -CertPassword "<password>"
```
