# Vyro-Car Trial · See It On Your Car

Interactive virtual wheel & rim visualizer studio built for **Top Performance** ([topperformance.qa](https://topperformance.qa)) by **DEVSYNX**.

Allows automotive enthusiasts and customers to preview real performance wheels on demo vehicles or their own uploaded cars in real time, with realistic brake caliper customization, split-view before/after comparison, live tire sizing, and instant WhatsApp quote generation.

---

## Quickstart

Run the studio locally:

```bash
# Start local server on port 3000
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

Or open `see-it-on-your-car/index.html` directly in any web browser.

---

## Key Features

1. **16 Demo Vehicles**:
   - Toyota Land Cruiser 300 & Prado 250
   - Nissan Patrol Y63 & Y62 Nismo
   - Lexus LX 600 & GX 550
   - GMC Yukon Denali & Chevrolet Tahoe
   - Cadillac Escalade
   - Ford F-150 Raptor
   - Toyota Hilux GR Sport
   - Jeep Wrangler Rubicon
   - Mercedes-AMG G 63
   - Range Rover & Land Rover Defender 110
   - Toyota Land Cruiser 70

2. **Curated Wheel Catalog**:
   - Features Weld Racing Laguna 6, Weld Solana Drag, Vossen HF6-3 Hybrid Forged, fifteen52 Neito HD, and fifteen52 Analog HD.
   - Sourced directly from Top Performance Qatar with exact QAR pricing.
   - Keyed transparent spoke overlays revealing brake discs and custom calipers.
   - Real-time bolt pattern compatibility indicator (e.g., *Fits LC300* vs *Does not fit*).
   - Fast filter pills by fitment and bolt pattern.

3. **Customization & Controls**:
   - **Interactive Split Slider**: Before & after stock vs build comparison slider.
   - **View Modes**: Split before/after, Build-only, and Side-by-side.
   - **Brake Calipers**: 6 finish options (Factory, Brembo red, Acid yellow, Nismo orange, Acid green, Satin black).
   - **Wheel Position Live Adjuster**: Drag hub centers and scale rim diameters directly on any vehicle or custom uploaded photo.
   - **Own Car Photo Upload**: Upload side-profile photos with live wheel hub calibration.

4. **Conversion & Sharing**:
   - **HD Build Card Export**: High-resolution downloadable build sheet with specs, vehicle pairing, and QR branding.
   - **Direct WhatsApp Quote**: One-click WhatsApp link pre-filled with vehicle model, chosen wheels, specs, and price to the Top Performance sales team.

---

## Directory Structure

```text
vyro-car/
├── package.json               # NPM scripts (npm run dev)
├── requirements.txt           # Python packages for the catalog tools
├── catalog/products.json      # Source list of wheels (edit or import)
├── tools/
│   ├── import_feed.py         # Store feed -> catalog/products.json
│   └── build_catalog.py       # Product photos -> textures, 3D params, quality flags
└── see-it-on-your-car/        # Studio application (deployed folder)
    ├── index.html             # Studio
    ├── admin.html             # Catalog review page
    ├── embed.js               # "See it on your car" button for store product pages
    ├── catalog.json           # Built catalog (generated)
    ├── js/wheel3d.js          # 3D wheel builder and renderer
    ├── js/detect.js           # Automatic wheel detection
    ├── vendor/                # three.js (MIT)
    ├── wheel-models/          # Normalised wheel textures (generated) and optional .glb models
    ├── wheel-overlays/        # Original product cutouts
    ├── vehicles-manifest.json # Vehicle hub coordinates & specs
    ├── cars/                  # Demo vehicle JPGs & thumbnails
    └── source-renders-2k/     # Original 2K studio vehicle renders
```

---

## Built By

Developed by **DEVSYNX** for **Top Performance** (Doha, Qatar).
