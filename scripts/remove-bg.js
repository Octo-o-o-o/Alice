
import { Jimp } from 'jimp';
import fs from 'fs';

async function main() {
    const iconPath = 'src-tauri/icons/original-source.png';
    const outputPath = 'src-tauri/icons/fixed-icon.png';

    if (!fs.existsSync(iconPath)) {
        console.error(`Icon not found: ${iconPath}`);
        process.exit(1);
    }

    try {
        console.log('Reading image...');
        const image = await Jimp.read(iconPath);
        const width = image.bitmap.width;
        const height = image.bitmap.height;

        console.log(`Image size: ${width}x${height}`);

        function intToRGBA(i) {
            return {
                r: (i >>> 24) & 0xFF,
                g: (i >>> 16) & 0xFF,
                b: (i >>> 8) & 0xFF,
                a: i & 0xFF
            };
        }

        // Tolerance for color similarity (0-255)
        // White background is usually (255,255,255)
        // We want to remove corners which are white.
        // The icon is rounded-square, so the corners are empty white space.
        const tolerance = 40;

        function isSimilar(color1Int, color2Int) {
            const c1 = intToRGBA(color1Int);
            const c2 = intToRGBA(color2Int);
            const dist = Math.sqrt(
                Math.pow(c1.r - c2.r, 2) +
                Math.pow(c1.g - c2.g, 2) +
                Math.pow(c1.b - c2.b, 2)
            );
            return dist <= tolerance;
        }

        function floodFill(startX, startY) {
            if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;

            const startColor = image.getPixelColor(startX, startY);
            const startRGBA = intToRGBA(startColor);

            // We only want to remove "white-ish" background pixels.
            // If the corner is NOT white, we shouldn't touch it.
            if (startRGBA.r < 240 || startRGBA.g < 240 || startRGBA.b < 240) {
                console.log(`- Skipping flood fill at (${startX},${startY}) - color too dark/colorful: ${JSON.stringify(startRGBA)}`);
                return;
            }

            console.log(`+ Flooding from (${startX},${startY}) - color: ${JSON.stringify(startRGBA)}`);

            const queue = [[startX, startY]];
            const visited = new Set();

            let count = 0;

            while (queue.length > 0) {
                const [x, y] = queue.shift();
                const key = `${x},${y}`;

                if (visited.has(key)) continue;
                visited.add(key);

                const currentColor = image.getPixelColor(x, y);

                // Check if this pixel is similar to the STARTING white color
                if (!isSimilar(currentColor, startColor)) continue;

                // Set transparent
                image.setPixelColor(0x00000000, x, y);
                count++;

                // Neighbors
                const neighbors = [
                    [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
                ];

                for (const [nx, ny] of neighbors) {
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        queue.push([nx, ny]);
                    }
                }
            }
            console.log(`  > Cleared ${count} pixels.`);
        }

        // Flood fill from 4 corners
        floodFill(0, 0);
        floodFill(width - 1, 0);
        floodFill(0, height - 1);
        floodFill(width - 1, height - 1);

        console.log('Writing output...');

        await new Promise((resolve, reject) => {
            image.write(outputPath, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        console.log(`Saved to ${outputPath}`);

    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main();
