# Credits

## Characters (HQ #90c)
Rigged, skinned, animated office people in `assets/chars/` are composed from the **Quaternius** modular character packs
(one shared 62-bone rig, so heads/bodies/legs/feet mix freely, then recolored per cast member in `characters.js`):

| File | Source model | Pack |
|---|---|---|
| suitM.glb (+ Idle/Walk/Run/Interact/Wave/Idle_Neutral clips) | Business Man (Suit) | Ultimate Modular Men Pack |
| casualM.glb | Casual Character | Ultimate Modular Men Pack |
| casual2M.glb | Casual Character 2 | Ultimate Modular Men Pack |
| workerM.glb | Worker | Ultimate Modular Men Pack |
| suitW.glb | Suit | Ultimate Modular Women Pack |
| formalW.glb | Animated Woman (Formal) | Ultimate Modular Women Pack |
| casualW.glb | Animated Woman (Casual) | Ultimate Modular Women Pack |

- Author: Quaternius, https://quaternius.com (packs: ultimatemodularmen, ultimatemodularwomen)
- Downloaded 2026-10-12 from Poly Pizza: https://poly.pizza/bundle/Ultimate-Modular-Men-Pack-ZiH8muWqwQ and
  https://poly.pizza/bundle/Ultimate-Modular-Women-Pack-aCBDXDdTNN
- License: **CC0 1.0 Public Domain** (Quaternius pack pages and FAQ: "All models are under the CC0 License").
  Poly Pizza tags a few of the women's uploads (Suit) as CC-BY; credit is given here either way.
- Processing: unused animations stripped, welded, deduped, meshopt-compressed with glTF-Transform (EXT_meshopt_compression).

## Libraries
- three.js r169 (MIT): `vendor/three.module.js`, `vendor/jsm/` (GLTFLoader, SkeletonUtils, BufferGeometryUtils, meshopt decoder; MIT)


## Procedural textures (HQ #101)
All exterior/interior material maps added in this pass are **procedural canvas textures** generated at runtime in `main.js` (sky gradient, bark, foliage noise, building window facades, carpet, chair fabric, concrete columns, grass). No third-party image assets were downloaded.
