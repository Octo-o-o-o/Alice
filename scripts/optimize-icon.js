
import { Jimp } from 'jimp';

async function checkIcon() {
    // Use source-icon.png (the one with transparent background)
    const image = await Jimp.read('src-tauri/icons/source-icon.png');
    console.log('Original Size:', image.bitmap.width, 'x', image.bitmap.height);

    let minX = image.bitmap.width, maxX = 0, minY = image.bitmap.height, maxY = 0;
    let hasPixels = false;

    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
        const a = this.bitmap.data[idx + 3];
        if (a > 10) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            hasPixels = true;
        }
    });

    if (hasPixels) {
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        console.log(`Content Bounding Box: (${minX}, ${minY}) to (${maxX}, ${maxY})`);
        console.log(`Content Size: ${width}x${height} (Aspect Ratio: ${(width / height).toFixed(2)})`);

        // Auto-crop and resize if margin > 10px
        if (minX > 10 || minY > 10 || (image.bitmap.width - maxX) > 10 || (image.bitmap.height - maxY) > 10) {
            console.log('Cropping and resizing needed...');

            // Jimp v1.0+ API: crop({ x, y, w, h })
            image.crop({ x: minX, y: minY, w: width, h: height });

            // Resize to 1024x1024 full bleed
            const targetSize = 1024;
            const resizedImage = new Jimp({ width: targetSize, height: targetSize });

            // Resize content to fit
            image.resize({ w: targetSize, h: targetSize });

            // Composite
            resizedImage.composite(image, 0, 0);

            await resizedImage.write('src-tauri/icons/optimized-source-icon.png');
            console.log('Saved optimized-source-icon.png');
        } else {
            console.log('Icon already fills the canvas reasonably well.');
        }

    } else {
        console.log('Image appears empty (transparent).');
    }
}

checkIcon();
