
import { Jimp } from 'jimp';

async function generateTrayFromMain() {
    console.log('Generating Tray Icon from Main Icon...');

    try {
        // Use the optimized main icon (already cropped to content)
        const image = await Jimp.read('src-tauri/icons/optimized-source-icon.png');

        // Resize to 44x44 (High-DPI Tray)
        // Since input is square and cropped, this maximizes the icon size.
        // We use 44px which renders as 22pt (Standard Menu Bar height).
        image.resize({ w: 44, h: 44 });

        // Convert to Stencil (Monochrome)
        // The icon is Orange/Pink/White.
        // We want:
        // - Colored parts (Waves) -> Black (Opaque)
        // - White parts (Background/Lines) -> Transparent

        image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
            const r = this.bitmap.data[idx];
            const g = this.bitmap.data[idx + 1];
            const b = this.bitmap.data[idx + 2];
            const a = this.bitmap.data[idx + 3];

            // Calculate brightness
            const brightness = (r + g + b) / 3;

            // "White" or very light pixels -> Transparent
            // The icon has white lines between waves.
            if (brightness > 200) {
                this.bitmap.data[idx + 3] = 0; // Transparent
            } else {
                // Colored pixels -> Black
                this.bitmap.data[idx] = 0;
                this.bitmap.data[idx + 1] = 0;
                this.bitmap.data[idx + 2] = 0;
                this.bitmap.data[idx + 3] = 255; // Fully Opaque
            }
        });

        await image.write('src-tauri/icons/tray-icon.png');
        console.log('✅ Generated max-size stencil tray icon.');

    } catch (err) {
        console.error('Error:', err);
    }
}

generateTrayFromMain();
