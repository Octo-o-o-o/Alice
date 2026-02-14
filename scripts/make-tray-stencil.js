
import { Jimp } from 'jimp';

async function makeStencil() {
    console.log('Generating high-contrast stencil...');

    // 1. Read the optimized source (which is the full color icon)
    const image = await Jimp.read('src-tauri/icons/optimized-source-icon.png');

    // 2. Resize to a manageable size for processing (e.g., 256x256) 
    // to keep details but be faster, then downscale to 44x44.
    image.resize({ w: 256, h: 256 });

    // 3. Process to Stencil (Black & Transparent)
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
        const r = this.bitmap.data[idx];
        const g = this.bitmap.data[idx + 1];
        const b = this.bitmap.data[idx + 2];
        const a = this.bitmap.data[idx + 3];

        if (a < 50) {
            // Already transparent
            this.bitmap.data[idx + 3] = 0;
            return;
        }

        // Calculate brightness (Perceived)
        const brightness = (r * 0.299 + g * 0.587 + b * 0.114);

        // Threshold: 
        // The center pixel was ~245 (very light).
        // The waves are likely darker (Orange/Pink).
        // Let's try to make "Dark/Color" -> Black, "Light" -> Transparent.
        // Threshold around 220? 
        // If it's a "white on color" icon, this will invert it (Background becomes black, shape becomes transparent).
        // If it's "color on white", this works (Shape becomes black, background transparent).

        // Let's try to detect if it's "Color on White" or "White on Color".
        // The corners are transparent. The shape is a circle.
        // Inside the circle, is the area mostly light or dark?
        // Center pixel was 240+ (Light).
        // This implies "Color on White" or "White Background with lines".
        // So: Keep Darker pixels as Black, make Lighter pixels Transparent.

        if (brightness < 210) {
            // Darker -> Black Ink
            this.bitmap.data[idx] = 0;
            this.bitmap.data[idx + 1] = 0;
            this.bitmap.data[idx + 2] = 0;
            this.bitmap.data[idx + 3] = 255;
        } else {
            // Lighter -> Transparent Paper
            this.bitmap.data[idx + 3] = 0;
        }
    });

    // 4. Autocrop again to ensure we don't have empty space from the circle container
    // If the "circle background" was white and we made it transparent, we might have just the waves left.
    // We want the waves to be big.

    let minX = image.bitmap.width, maxX = 0, minY = image.bitmap.height, maxY = 0;
    let hasContent = false;

    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
        if (this.bitmap.data[idx + 3] > 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            hasContent = true;
        }
    });

    if (hasContent) {
        const w = maxX - minX + 1;
        const h = maxY - minY + 1;
        image.crop({ x: minX, y: minY, w: w, h: h });
    }

    // 5. Final Resize to 44x44
    // Use 'bezier' interpolation for smoother edges on the binary image? 
    // Or 'nearest' for crisp pixel art? Bezier/Bilinear is usually better for scaling down.
    image.resize({ w: 44, h: 44 });

    await image.write('src-tauri/icons/tray-icon.png');
    console.log('✅ Generated refined stencil tray icon.');
}

makeStencil();
