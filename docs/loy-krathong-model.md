# Loy Krathong koi game asset

Runtime asset: `public/models/fish/loy_krathong.glb`.

The model uses 12,376 triangles, four materials, and nine embedded PBR textures.
The GLB is approximately 1.2 MB. Body, fins, and botanical details have base color,
tangent-space normal, and metallic/roughness maps. All surfaces are nonmetallic;
the candle flame uses emission. The fin material uses double-sided alpha blending.
Three.js renders five passes because the transparent fins are double-sided.

The head points along +Z, with +Y up and total length normalized to one unit.
Authored `_FLEX` vertex weights drive the existing fish shader, with zero fin
flutter on the lotus. There is no skeleton or embedded animation clip.

Use this model configuration when adding the species to the catalogue:

```js
model: {
  url: 'models/fish/loy_krathong.glb',
  rotation: [0, 0, 0],
  motion: 'fish',
}
```

This asset change does not register a species, price, or seasonal unlock.

## Local source and verification

The existing repository ignores `Fish/`, where the working assets are saved:

- `Fish/loy_krathong_game.blend` — editable meshes and packed PBR textures.
- `Fish/build_loy_krathong_game.py` — Blender builder, requires the Natural Koi source scene.
- `Fish/loy_krathong_textures/` — uncompressed texture PNGs.
- `Fish/loy_krathong_game_src.glb` — uncompressed export with authored flex weights.

Repackage with `node scripts/build-loy-krathong-model.mjs`.
The script retains texture UVs and flex weights while simplifying and compressing.

Run `node Fish/check_loy_krathong.mjs` for a local headless Chrome check. It loads the
actual GLB through `AssetLoader`, checks the PBR maps, applies the game's fish-motion
shader, and captures two swimming poses. The latest run had no browser errors.
This is asset-preview validation, not a production aquarium performance benchmark.

With Vite running, `/Fish/loy_krathong_preview.html` provides an orbitable preview
with a swimming toggle. Screenshots and reports are stored beside the blend file.
