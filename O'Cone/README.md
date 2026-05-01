# O'Cone

CEP-плагін для Adobe Illustrator. Створює conical (sweep) gradient — fan з N трикутників від центру об'єкта, обрізаний формою цього об'єкта. Порт `O'Tool/O'Cone.jsx` v3 (Mask Fix).

## Workflow

1. Виділіть один або кілька shapes на artboard
2. **`CONE`** — для кожного shape будується preview group `OCone_Result` (mask + fan), оригінали ховаються, плагін переходить в ACTIVE
3. У стані ACTIVE крутіть **Style** і **Quality** — preview оновлюється наживо
4. **`APPLY`** видаляє оригінали (preview лишається як фінальний результат). Або **`CANCEL`** — видаляє previews і повертає оригінали.

## Параметри

- **Style** — 5 пресетів кольору:
  - **Silver (Metallic)** — біло-сірі rotations
  - **Gold (Metallic)** — теплий золотий метал
  - **Holographic (Rainbow)** — повний rainbow loop
  - **Radar (Green)** — зелений з різким падінням наприкінці
  - **Spectrum (Full RGB)** — чорний → сірий → білий
- **Quality** — кількість трикутників у fan (більше = плавніше). Slider 50–720, число до 2000.

## Оптимізація

- Зміна **Style** не перебудовує геометрію — тільки `fillColor` на існуючих сегментах. Перемикання пресетів — миттєве навіть на multi-select.
- Зміна **Quality** перебудовує fan — час пропорційний кількості сегментів × кількості shapes.

## Розробка

```powershell
.\install.ps1 -EnableDebugMode
.\uninstall.ps1
```

## Збірка ZXP

```powershell
.\build-zxp.ps1 -SignToolPath "<ZXPSignCmd.exe>" -CertPath "<cert.p12>" -CertPassword "<password>"
```
