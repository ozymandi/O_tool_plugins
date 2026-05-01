# O'Line

CEP-плагін для Adobe Illustrator. Будує мережу з'єднань між обраними anchor-точками за однією з 14 топологій. Порт O'Line Generator v6.2 з істотним розширенням алгоритмів.

## Workflow

1. Виділіть якорі (Direct Selection / White Arrow) на ≥2 точках, або кілька single-point path-ів
2. **`LINE`** — будується `OLine_Preview` group з усіма connection-ами
3. У ACTIVE крутіть параметри — preview оновлюється наживо
4. **`APPLY`** залишає preview як фінал. Або **`CANCEL`** — видаляє. Або **`BAKE TO SYMBOL`** — зберігає поточний варіант у Symbols panel і одразу будує новий preview (зручно для bulk-variations).

## 14 топологій

**Graph (network):**
- **All to All** — повний граф K_n
- **Chain (Sequence)** — послідовність i → i+1
- **Loop (Closed Chain)** — chain + замикання останньої точки на першу
- **Step-Skip** — pattern: take T edges, skip S edges, repeat
- **Modular Skip** — i → (i + k) mod n, де k = Skip. На 7 точках з k=3 → Star of David
- **Random Connections** — кожна точка → T випадкових інших; seed cache, реролл лише через NEW SEED
- **Threshold Distance** — пара з'єднується якщо відстань ≤ D пікселів

**Radial:**
- **Radial (Center)** — центроїд → кожна точка
- **Star from Pivot** — перша виділена точка → всі інші

**Proximity:**
- **Nearest Neighbors** — кожна точка → T найближчих
- **K-Nearest Mutual** — як Nearest, але edge тільки якщо обидві точки взаємно мають одна одну в своїх K найближчих (чистіша топологія)

**Geometric:**
- **Convex Hull** — outline зовнішнього контуру (gift-wrapping algorithm)
- **Minimum Spanning Tree** — оптимальне дерево зв'язку (Prim's algorithm); органічна нейронна мережа
- **Delaunay Triangulation** — класична триангуляція без перекритих ребер (Bowyer-Watson incremental); основа для low-poly mesh art

## Параметри

- **Style:** Bezier checkbox + Tension slider (-400..+400) + Stroke width (pt)
- **Logic** (показується залежно від топології):
  - Take / Neighbors — для Step-Skip, Random, Nearest, K-Nearest Mutual
  - Skip — для Step-Skip, Modular Skip
  - Distance (px) — для Threshold Distance
- **Random Seed** (тільки для Random) — `NEW SEED` button

## Розробка

```powershell
.\install.ps1 -EnableDebugMode
.\uninstall.ps1
```

## Збірка ZXP

```powershell
.\build-zxp.ps1 -SignToolPath "<ZXPSignCmd.exe>" -CertPath "<cert.p12>" -CertPassword "<password>"
```
