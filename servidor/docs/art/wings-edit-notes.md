# Wing atlas correction

Edited with the built-in image generation tool, then registered and exported as lossless WebP using Sharp.

Final assets in the project root:
- bat_demon_wings.webp
- crimson_butterfly_wings.webp
- dark_demon_wings.webp
- mechanical_demon_wings.webp

All four use 1024 × 512 RGBA, four columns, two rows, eight 256 × 256 frames. Existing avatar UV animation and shop references are retained. Original files are backed up in `.visual-baseline/wings-original/`.

## Prompt specification

Edit the target wing sprite sheet using Angel Wings as the layout and animation reference. Preserve the target's crimson/black palette and distinctive bat, butterfly, feathered or mechanical identity. Create eight complete bilateral pairs in a 4 × 2 transparent atlas. Keep a fixed attachment point at (128,144) within each 256 × 256 cell, consistent scale and safe margins. Animate a gentle cyclic flap in row-major order: medium, raised, highest, raised, medium, lowered, lowest, returning. No body, text, grid, background, particles or external glow haze.

For Dark Demon and Mechanical Demon, a second edit used Crystal Wings as the pose/layout reference: rebuild all eight frames from one consistent feathered/faceted design; tips remain upward and outward throughout a gentle flap, with no upside-down frames or shape changes.

## Export checks

`scripts/normalize-wing-atlases.cjs` registers generated frames and writes the game files. It validates nonempty frames and transparent margins on all sides. The five original reference wing assets are unchanged.
