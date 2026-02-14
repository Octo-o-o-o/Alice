
import { Jimp } from 'jimp';

async function invertTrayIcon() {
    console.log('Generating Inverted Tray Icon (Keep White as Content, Remove Color)...');

    // Load the matching source
    const image = await Jimp.read('src-tauri/icons/optimized-source-icon.png');

    // Resize to 44x44
    image.resize({ w: 44, h: 44 });
    const width = 44;
    const height = 44;
    const center = 21.5;
    const radius = 21;

    // Iterate every pixel
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = image.getPixelIndex(x, y);

            // 1. CIRCULAR MASK (Keep strict circle)
            const dx = x - center;
            const dy = y - center;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > radius) {
                image.bitmap.data[idx + 3] = 0;
                continue;
            }

            // 2. INVERTED LOGIC
            // Previous: Color -> Black (Opaque), White -> Transparent
            // Result: Solid Circle with transparent lines (Too heavy).

            // New Goal: Keep the "White Lines" as the Icon, make the "colored circle" transparent.

            const r = image.bitmap.data[idx];
            const g = image.bitmap.data[idx + 1];
            const b = image.bitmap.data[idx + 2];
            const a = image.bitmap.data[idx + 3];

            if (a < 50) {
                image.bitmap.data[idx + 3] = 0;
                continue;
            }

            // Analysis:
            // "White" pixels have High Brightness (>200) AND Low Saturation (<30).
            // "Color" pixels (Orange/Pink) have Lower Brightness or High Saturation.

            const brightness = (r + g + b) / 3;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const saturation = max - min;

            const isWhiteOrLight = (brightness > 180 && saturation < 40); // Broadened definition of white

            if (isWhiteOrLight) {
                // This is the Wave Line (originally White).
                // We want this to be the ICON (Opaque Black).
                image.bitmap.data[idx] = 0;
                image.bitmap.data[idx + 1] = 0;
                image.bitmap.data[idx + 2] = 0;
                image.bitmap.data[idx + 3] = 255;
            } else {
                // This is the Orange/Pink Background.
                // We want this to be TRANSPARENT (Gone).
                image.bitmap.data[idx + 3] = 0;
            }
        }
    }

    await image.write('src-tauri/icons/tray-icon.png');
    console.log('✅ Generated Inverted Tray Icon: White Lines became Black Content.');
}

invertTrayIcon();
