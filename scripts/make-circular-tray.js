
import { Jimp } from 'jimp';

async function makeCircularTray() {
    console.log('Generating circular stencil tray icon...');

    // 1. Read the optimized source
    const image = await Jimp.read('src-tauri/icons/optimized-source-icon.png');

    // 2. Resize to 44x44 (High DPI Tray)
    image.resize({ w: 44, h: 44 });

    const width = 44;
    const height = 44;
    const center = width / 2;
    const radius = (width / 2) - 1; // Leave 1px margin for anti-aliasing feel

    // 3. Process Pixels
    image.scan(0, 0, width, height, function (x, y, idx) {
        // A. Circular Mask
        const dx = x - center;
        const dy = y - center;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > radius) {
            // Outside circle -> Transparent
            this.bitmap.data[idx + 3] = 0;
            return;
        }

        // B. Color Thresholding (Orange vs White)
        const r = this.bitmap.data[idx];
        const g = this.bitmap.data[idx + 1];
        const b = this.bitmap.data[idx + 2];
        const a = this.bitmap.data[idx + 3];

        if (a < 50) {
            this.bitmap.data[idx + 3] = 0;
            return;
        }

        // Calculate Saturation and Brightness to distinguish Color vs White
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2; // Exact lightness
        const d = max - min;
        const s = l > 128 ? d / (2 * 128 - max - min) : d / (max + min); // Normalized saturation
        // Note: s is 0..1 here roughly if computed floating point, but we have integers.
        // Simplified Saturation: (max - min) is a good proxy for saturation.
        const saturation = max - min;

        // Logic:
        // "Orange" (Waves) should be VISIBLE (Black in stencil).
        // "White" (Background/Lines) should be TRANSPARENT.

        // High lightness AND Low saturation = White/Grey -> Transparent
        // High saturation OR Darker = Color -> Opaque

        if (l > 200 && saturation < 30) {
            // White/Light Grey -> Transparent
            this.bitmap.data[idx + 3] = 0;
        } else {
            // Color -> Black (Opaque)
            this.bitmap.data[idx] = 0;
            this.bitmap.data[idx + 1] = 0;
            this.bitmap.data[idx + 2] = 0;
            this.bitmap.data[idx + 3] = 255;
        }
    });

    await image.write('src-tauri/icons/tray-icon.png');
    console.log('✅ Generated circular stencil tray icon.');
}

makeCircularTray();
