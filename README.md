# ไพ่โคมไฟ · Lantern Cards (Web 3D)

Browser version of the Unity roguelite card battler, built with three.js.
Akari, the monsters, the companions and the battle arenas are the same 3D models as the Unity version,
exported to `.glb` by `AshenVow/Assets/LanternCards/Editor/WebExport.cs` (the Unity project is not in this repo).

## Play

```powershell
npm install
python tools/serve.py
```

Then open http://localhost:5173 in a browser. Progress is saved in the browser (localStorage).

- `python tools/serve.py 8080 --lan` also lets phones on the same Wi-Fi open `http://<this PC's IP>:8080`
- `?test` uses a separate save (for testing without touching real progress)
- `?fast` skips animations (for automated runs)
- Keys: `E` = end turn, `Esc` = back from menu screens

## Test

```powershell
node tools/bot.mjs
```

Rules checks, bot runs through all three chapters, and a balance report (no team vs full team).

## Layout

| Path | What |
| --- | --- |
| `js/data.js`, `js/core.js`, `js/flow.js` | Game rules, gacha, map, battles, saving (ported from LcData/LcCore/LcGame) |
| `js/stage.js` | three.js scene: toon shading + outlines, arenas, actors, camera, element effects |
| `js/projection.js` | Colours the untextured Meshy heroine sculpts by projecting their pictures onto them |
| `js/ui.js`, `css/style.css` | Every screen in HTML on a 1920x1080 stage scaled to the window |
| `js/audio.js` | Synthesized sounds and music (port of Synth) |
| `js/main.js` | Wires everything together and plays battle events |
| `assets/models` | `akari.glb` (19 baked animations), `creatures/*.glb`, `arenas/*.glb`, `heroines/*.fbx` (Meshy 6 Lite sculpts), `heroines/*.glb` (the same sculpts rigged by `tools/rig`) |
| `assets/models/heroines/projection.json` | Where each heroine's picture sits on her sculpt |
| `assets/art` | Card art, heroine portraits, logo, gacha banner, companion portraits, projection pictures |
| `source_art/meshy_input` | The single-heroine pictures that were sent to Meshy |
| `tools/bot.mjs` | Node test (see above) |
| `tools/glbinfo.mjs` | Lists the heaviest meshes/textures in a .glb |
| `tools/align.html` | Checks a heroine's projected picture against her sculpt (`/tools/align.html?id=homura`) |
| `tools/serve.py` | No-cache local server |
| `tools/rig/` | Rigs the heroine sculpts with Akari's skeleton and clips (see below) |

## Rigging the heroines

The Meshy sculpts have no skeleton, so `tools/rig` gives each one Akari's (23 bones) and her 19 clips:

```powershell
node tools/rig/build.mjs            # all heroines, or: node tools/rig/build.mjs minase
```

- `tools/rig/joints.json` says where each joint sits in each sculpt (metres; 1.75 m tall, feet at y = 0, facing +Z).
  `node tools/rig/joints-view.mjs homura out.png front,side` draws them over the sculpt to check or move them.
- Skin weights are automatic: each bone owns the surface around it and the rest follows along the surface,
  so hair, sleeves and held weapons move with the part they grow from. Floating pieces ride on the torso.
- Clips are blended toward the sculpt's own pose (`AMOUNT` in `tools/rig/anim.mjs`): arms do most of the
  acting, legs and hips stay close to the sculpt so long dresses keep their shape. The `pose` clip is the
  sculpt's pose breathing with Akari's idle.
- Per heroine, `joints.json` can also hold `amount` (override `AMOUNT`, e.g. `"leftArm": 0.25` keeps Minase's
  sleeve-bound left arm calm), `weights` (`radius` per bone kind for the surface each bone claims) and `clips`:
  hand-keyed moves on top of the sculpt's pose (Tsubaki's `shoot` and `bless`), each key turning bones about
  the character's own axes in degrees (X right, Y up, Z toward the enemy).
- `node tools/rig/preview.mjs minase out.png front "bind!,pose@1,attack1@0.2,spell@0.25"` renders poses without
  a browser (`!` colours the surface by bone). `node tools/rig/stretch.mjs minase attack1,block` measures how much
  a clip stretches the surface. Both need `sharp` / plain Node (`npm i -D sharp` for the PNGs).
- Which clip each heroine strikes and supports with, and who shoots from afar: `HEROINE_MOVES` in `js/stage.js`.
  A heroine without a `.glb` falls back to her static `.fbx`.

## Re-exporting models from Unity

With the AshenVow project open in Unity: menu **Lantern Cards → Web → Export Hero / Export Cast / Export Arenas**.

## Credits

Monsters, nature and props: Quaternius (CC0). Heroine sculpts: generated with Meshy (CC BY 4.0). Font: Kanit (OFL). three.js (MIT).
