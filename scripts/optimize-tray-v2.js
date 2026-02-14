
import { Jimp } from 'jimp';

async function optimizeTray() {
    console.log('Optimizing Tray Icon...');

    try {
        const image = await Jimp.read('src-tauri/icons/tray-icon-source.png');

        // 1. Analyze content to find bounding box
        let minX = image.bitmap.width, maxX = 0, minY = image.bitmap.height, maxY = 0;
        let hasPixels = false;

        image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
            const r = this.bitmap.data[idx];
            const g = this.bitmap.data[idx + 1];
            const b = this.bitmap.data[idx + 2];
            const a = this.bitmap.data[idx + 3];

            // Criteria for "Content":
            // 1. Not fully transparent (a > 10)
            // 2. Not white (r,g,b < 240) - strictly treating white as background to fix "white square"

            const isWhite = (r > 240 && g > 240 && b > 240);
            const isTransparent = (a < 10);

            if (!isTransparent && !isWhite) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                hasPixels = true;
            }
        });

        if (!hasPixels) {
            console.error('Error: No icon content found (image appears empty or full white)');
            return;
        }

        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        console.log(`Found content: ${width}x${height} at ${minX},${minY}`);

        // 2. Crop to content
        image.crop({ x: minX, y: minY, w: width, h: height });

        // 3. Resize to standard tray size (Retina: 44px height usually max)
        // To make it "Big", we use full 44px height.
        // Or 22px for 1x. Tauri handles scaling if we provide high res?
        // Usually providing a 32px or 44px image is good for macOS tray.
        // Let's go with 44px (Retina 22pt) and standard 2px padding -> 40px content?
        // User wants "Big", so let's try 44px which is edge-to-edge for the menu bar height.

        const targetHeight = 44;
        const scaleFactor = targetHeight / height;
        const targetWidth = Math.round(width * scaleFactor);

        // Create a canvas exactly the size of the icon (44px height)
        // Do NOT add extra padding canvas, just the icon itself.
        image.resize({ w: targetWidth, h: targetHeight });

        // 4. Force Monochrome/Stencil (Black & Transparent)
        // Iterate and clean up
        image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
            const r = this.bitmap.data[idx];
            const g = this.bitmap.data[idx + 1];
            const b = this.bitmap.data[idx + 2];
            const a = this.bitmap.data[idx + 3];

            const isWhite = (r > 200 && g > 200 && b > 200);

            if (a < 50 || isWhite) {
                // Background -> Transparent
                this.bitmap.data[idx + 3] = 0;
            } else {
                // Content -> Pure Black, Full Opacity
                this.bitmap.data[idx] = 0;
                this.bitmap.data[idx + 1] = 0;
                this.bitmap.data[idx + 2] = 0;
                this.bitmap.data[idx + 3] = 255;
            }
        });

        await image.write('src-tauri/icons/tray-icon.png');
        console.log('Saved src-tauri/icons/tray-icon.png');

    } catch (err) {
        console.error('Error:', err);
    }
}

optimizeTray();
