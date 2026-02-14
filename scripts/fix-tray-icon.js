
import { Jimp } from 'jimp';

async function main() {
    console.log('Fixing tray icon...');

    // Use the AI-generated stencil which has the correct shape (waves in circle)
    // Instead of the thresholded squircle which became a solid block.
    try {
        const stencil = await Jimp.read('src-tauri/icons/tray-icon-source.png');

        // Resize to standard tray icon size (22pt @ 2x = 44px)
        const size = 44;
        stencil.resize({ w: size, h: size });

        // Ensure it is truly a stencil (only black and transparent)
        // Iterate and force non-transparent pixels to black
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                const color = stencil.getPixelColor(x, y);
                const rgba = {
                    r: (color >>> 24) & 0xFF,
                    g: (color >>> 16) & 0xFF,
                    b: (color >>> 8) & 0xFF,
                    a: color & 0xFF
                };

                // If somewhat opaque, make it solid black
                if (rgba.a > 50) {
                    stencil.setPixelColor(0x000000FF, x, y); // Black, Opaque
                } else {
                    stencil.setPixelColor(0x00000000, x, y); // Transparent
                }
            }
        }

        await stencil.write('src-tauri/icons/tray-icon.png');
        console.log('✅ Restored correct stencil tray icon to src-tauri/icons/tray-icon.png');

    } catch (err) {
        console.error('Error fixing tray icon:', err);
    }
}

main();
