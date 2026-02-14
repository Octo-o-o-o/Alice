
import { Jimp } from 'jimp';

async function main() {
    console.log('Starting icon refinement...');

    // 1. Fix Dock Icon (Add padding back)
    try {
        // Start from my optimized (cropped) version which has no padding
        const image = await Jimp.read('src-tauri/icons/optimized-source-icon.png');

        // Target canvas size: 1024x1024
        // Standard macOS icon content area is ~824x824 within 1024x1024 (approx 10-15% margin)
        const canvasSize = 1024;
        const targetContentSize = 824;

        const canvas = new Jimp({ width: canvasSize, height: canvasSize }); // Transparent

        // Resize content
        image.resize({ w: targetContentSize, h: targetContentSize });

        // Center it
        const offset = (canvasSize - targetContentSize) / 2;
        canvas.composite(image, offset, offset);

        await canvas.write('src-tauri/icons/source-icon.png');
        console.log('✅ Dock icon padded and saved to src-tauri/icons/source-icon.png');

    } catch (err) {
        console.error('Error fixing dock icon:', err);
    }

    // 2. Fix Tray Icon (Extract circle, make monochrome stencil)
    try {
        // Use the original colered icon to get the shapes
        // But we want a "stencil" look. The user said "use the circular part".
        // Let's take the CENTER of the icon (which is the circle wave) and make it high contrast.

        const rawIcon = await Jimp.read('src-tauri/icons/original-source.png');
        // Retrieve the optimized opaque source if original is not good? 
        // Actually, let's use the one with transparency I made earlier: 'src-tauri/icons/fixed-icon.png' (if it exists)
        // or just re-process 'src-tauri/icons/original-source.png'

        // Crop to the center circle (approx 90% of the icon width is key content)
        const size = rawIcon.bitmap.width;
        // The icon is a squircle. The "wave circle" is inside.
        // Let's act conservatively and just use the whole shape as a mask, but scale it down.
        // But for a tray icon, it needs to be simple.

        // Let's resize to 64x64 for processing (high res tray)
        rawIcon.resize({ w: 64, h: 64 });

        // Turn to greyscale and threshold to make it black/transparent
        // This is a "template" icon, so alpha channel matters most.
        // Opaque pixels = drawing color (black/white/blue). Transparent = background.

        // Iterate pixels
        for (let x = 0; x < 64; x++) {
            for (let y = 0; y < 64; y++) {
                const color = rawIcon.getPixelColor(x, y);
                const rgba = {
                    r: (color >>> 24) & 0xFF,
                    g: (color >>> 16) & 0xFF,
                    b: (color >>> 8) & 0xFF,
                    a: color & 0xFF
                };

                // If it's transparent, keep it transparent
                if (rgba.a < 50) continue;

                // If it's "white" (background of the circle in the icon), make it transparent?
                // The icon is orange/pink waves on a white/cream background?
                // Actually the user's icon is: "Minimalist circle with abstract wave". 
                // It likely has a background color.
                // To make a stencil, we might need Edge Detection or just brightness mapping.

                // Simpler approach: Map brightness to Alpha. 
                // Darker parts (waves) -> Opaque (Black). Lighter parts -> Transparent.
                // Or vice versa? The waves are orange (medium), bg is light.
                // Let's try: White/Light = Transparent. Color/Dark = Black.

                const brightness = (rgba.r + rgba.g + rgba.b) / 3;

                if (brightness > 200) {
                    // Light -> Transparent
                    rawIcon.setPixelColor(0x00000000, x, y);
                } else {
                    // Dark/Color -> Solid Black
                    rawIcon.setPixelColor(0x000000FF, x, y);
                }
            }
        }

        // Save as tray icon
        await rawIcon.write('src-tauri/icons/tray-icon.png');
        console.log('✅ Tray icon stenciled and saved to src-tauri/icons/tray-icon.png');

    } catch (err) {
        console.error('Error fixing tray icon:', err);
    }
}

main();
