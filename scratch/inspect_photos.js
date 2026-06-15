const exifr = require('exifr');
const path = require('path');

const images = [
  '20251019_174521.jpg',
  '20220130_174222.jpg',
  '20221014_174506.jpg',
  '20240516_192636.jpg',
  '20191209_065429.jpg'
];

async function main() {
  for (const img of images) {
    const fullPath = path.join(__dirname, '../assets/photos_clean', img);
    try {
      const output = await exifr.parse(fullPath, {
        tiff: true,
        xmp: false,
        gps: false,
        exif: true
      });
      console.log(`${img}: width=${output?.ExifImageWidth || output?.PixelXDimension}, height=${output?.ExifImageHeight || output?.PixelYDimension}`);
    } catch (err) {
      console.error(`Error parsing ${img}:`, err.message);
    }
  }
}

main();
