
import { Jimp } from 'jimp';

async function makeOutlineTray() {
    console.log('Generating Outline Style Tray Icon (Ring + Waves)...');

    // Load source
    const image = await Jimp.read('src-tauri/icons/optimized-source-icon.png');

    // Resize to 44x44
    image.resize({ w: 44, h: 44 });
    const width = 44;
    const height = 44;
    const center = 21.5;
    const maxRadius = 21;
    const innerRadius = 19; // 2px thick ring

    // Iterate every pixel
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = image.getPixelIndex(x, y);

            const dx = x - center;
            const dy = y - center;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // 1. OUTSIDE -> Transparent
            if (dist > maxRadius) {
                image.bitmap.data[idx + 3] = 0;
                continue;
            }

            // 2. RING -> Solid Black
            // Creates a container circle so the icon isn't "empty" space.
            if (dist >= innerRadius && dist <= maxRadius) {
                image.bitmap.data[idx] = 0;
                image.bitmap.data[idx + 1] = 0;
                image.bitmap.data[idx + 2] = 0;
                image.bitmap.data[idx + 3] = 255;
                continue;
            }

            // 3. INSIDE: WAVE DETECTION
            // We use the "Inverted" logic to keep the waves, but discard the background color.

            const r = image.bitmap.data[idx];
            const g = image.bitmap.data[idx + 1];
            const b = image.bitmap.data[idx + 2];
            const a = image.bitmap.data[idx + 3];

            if (a < 50) {
                image.bitmap.data[idx + 3] = 0;
                continue;
            }

            const brightness = (r + g + b) / 3;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const saturation = max - min;

            // Detect "White Lines" (Waves)
            const isWave = (brightness > 180 && saturation < 40);

            if (isWave) {
                // WAVE -> Black
                image.bitmap.data[idx] = 0;
                image.bitmap.data[idx + 1] = 0;
                image.bitmap.data[idx + 2] = 0;
                image.bitmap.data[idx + 3] = 255;
            } else {
                // BACKGROUND COLOR -> Transparent
                image.bitmap.data[idx + 3] = 0;
            }
        }
    }

    await image.write('src-tauri/icons/tray-icon.png');
    console.log('✅ Generated Outline Tray Icon: Ring + Waves.');
}

makeOutlineTray();
