
import { Jimp } from 'jimp';

async function processTrayIcon() {
    const image = await Jimp.read('src-tauri/icons/tray-icon-source.png');

    // Resize to 64x64 for tray usage (Retina friendly)
    // Ensure it is square and centered if not already
    const size = 64;
    image.resize({ w: size, h: size });

    await image.write('src-tauri/icons/tray-icon.png');
    console.log('Processed tray-icon.png');
}

processTrayIcon();
