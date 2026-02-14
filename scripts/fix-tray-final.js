
import { Jimp } from 'jimp';

async function finalFixTray() {
    console.log('Final fix for tray icon (removing white box)...');

    // Load the high-res optimized icon
    // We assume this is the orange/pink icon
    const image = await Jimp.read('src-tauri/icons/optimized-source-icon.png');

    // Resize to 44x44
    image.resize({ w: 44, h: 44 });
    const width = 44;
    const height = 44;
    const center = 21.5; // (44-1)/2
    const radius = 21; // Leave 1px margin

    // Iterate every pixel
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = image.getPixelIndex(x, y);

            // 1. CIRCULAR MASK (Hard Cut)
            // Remove corners of the square
            const dx = x - center;
            const dy = y - center;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > radius) {
                // Outside circle -> Force Fully Transparent
                image.bitmap.data[idx + 3] = 0;
                continue;
            }

            // 2. BACKGROUND REMOVAL (White to Transparent)
            const r = image.bitmap.data[idx];
            const g = image.bitmap.data[idx + 1];
            const b = image.bitmap.data[idx + 2];
            const a = image.bitmap.data[idx + 3];

            if (a < 10) continue; // Already transparent

            // Check if pixel is "White" or "Light Grey"
            // The background is likely lighter than the content
            const brightness = (r + g + b) / 3;
            // Calculate saturation approximation (max - min)
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const saturation = max - min;

            // Content (Orange/Pink) has HIGH Saturation (>30) and variable brightness.
            // Background (White) has LOW Saturation (<20) and HIGH Brightness (>230).

            const isWhiteBackground = (brightness > 220 && saturation < 30);

            if (isWhiteBackground) {
                // Make Transparent
                image.bitmap.data[idx + 3] = 0;
            } else {
                // CONTENT: Make it Solid Black for Template Mode
                // The OS will recolor "Black Opaque" pixels to the appropriate text color.
                image.bitmap.data[idx] = 0;
                image.bitmap.data[idx + 1] = 0;
                image.bitmap.data[idx + 2] = 0;
                image.bitmap.data[idx + 3] = 255;
            }
        }
    }

    await image.write('src-tauri/icons/tray-icon.png');
    console.log('✅ Tray icon fixed: Circular crop + White removal applied.');
}

finalFixTray();
