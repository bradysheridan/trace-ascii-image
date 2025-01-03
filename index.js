// sobel kernels
const sobel_v = [
  -1.0, 0.0, +1.0,
  -2.0, 0.0, +2.0,
  -1.0, 0.0, +1.0
];
const sobel_h = [
  -1.0, -2.0, -1.0,
   0.0,  0.0,  0.0,
  +1.0, +2.0, +1.0
];

// pixel processor functions
// https://stackoverflow.com/questions/596216/formula-to-determine-perceived-brightness-of-rgb-color
const sRGBToLin = (colorChannel) => (colorChannel <= 0.04045) ? colorChannel / 12.92 : Math.pow(((colorChannel + 0.055)/1.055),2.4);
const YToLstar = (Y) => (Y <= (216/24389)) ? Y * (24389/27) : Math.pow(Y,(1/3)) * 116 - 16;
const pxluminosityWeightedAverage = (r, g, b) => 0.3*r + 0.59*g + 0.11*b;
const pxRGBAverage = (r, g, b) => (r+b+g)/3;
const pxLuminance = (r, g, b) => {
  let vR = r / 255;
  let vG = g / 255;
  let vB = b / 255;
  let Y = (0.2126 * sRGBToLin(vR) + 0.7152 * sRGBToLin(vG) + 0.0722 * sRGBToLin(vB));
  return Y;
}
const pxPerceivedLightness = (r, g, b) => {
  let Lstar = YToLstar(pxLuminance(r, g, b));
  return Lstar;
}

/**
 * Remaps number from one range to another.
 * @param {number} n - Number to be remapped
 * @param {number} start1 - Lower bound of original range
 * @param {number} stop1 - Upper bound of new range
 * @param {number} start2 - Lower bound of new range
 * @param {number} stop2 - Upper bound of new range
 * @returns {number} The remapped number.
 */
function remap(n, start1, stop1, start2, stop2) {
  if (start1 >= stop1 || start2 >= stop2)
    throw "Make sure specified ranges are ranges. Start values must be lower than stop values.";
  return (n - start1) / (stop1 - start1) * (stop2 - start2) + start2;
};

/**
 * Creates a greyscale map of the specified image.
 * @param {Object} config - The config object for this pixel map.
 * @param {Object} config.imageData - A sharp.js object of the image data.
 * @param {number} config.width - The image's width.
 * @param {Function} config.onPixel - The function called when a single pixel is processed.
 * @param {Function} config.onNewLine - The function called when the end of a row of pixels is reached.
 * @returns 
 */
function createPixelMap({
  imageData,
  width,
  onPixel,
  onNewLine
}) {
  let pixels = new Array(imageData.length * 0.25);

  // create greyscale map, calculating
  //  - rgb avergae
  //  - weighted luminosity
  //  - perceived lightness
  {
    let i = 0;

    while (i < imageData.length) {
      // let a = data[i - 1];
      let b = imageData[i + 2];
      let g = imageData[i + 1];
      let r = imageData[i];

      // calculate rgb avg, weighted luminosity and perceived lightness
      pixels[i * 0.25] = {
        rgbAverage: pxRGBAverage(r, g, b),
        luminosity: pxluminosityWeightedAverage(r, g, b),
        perceivedLightness: pxPerceivedLightness(r, g, b),
        rgb: [r,g,b]
      }

      i += 4;
    }
  }

  // detect edges, calculating
  //  - edge gradient magnitude (luminosity-based)
  //  - edge gradient angle (0° - 180°)
  for (let i = 0; i < pixels.length; i++) {
    let pixel = pixels[i];

    // loop our 3x3 kernels, build our kernel values
    let hSum = 0;
    let vSum = 0;
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        let pixel = pixels[i + (width * y) + x];
        let luminosity = pixel && pixel.luminosity ? pixel.luminosity : 0;
        let kernelAccessor = (x) * 3 + (y);
        hSum += luminosity * sobel_h[kernelAccessor];
        vSum += luminosity * sobel_v[kernelAccessor];
      }
    }
      
    // calculate pixel gradient and direction
    let gx = hSum * hSum;
    let gy = vSum * vSum;
    pixel.gMagnitude = Math.sqrt(gx + gy);
    pixel.gAngle = (Math.atan2(gy, gx) * 180) / Math.PI;

    // reached new line
    if (i % width === 0)
      onNewLine()

    // return px data for writing
    onPixel(pixel);
  };

  return pixels;
}

/**
 * Traces an image into its ASCII representation.
 * @param {object} image - Image config object
 * @param {Uint8ClampedArray} image.data - Image data (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8ClampedArray)
 * @param {number} image.width - Source image width
 * @param {number} image.height - Source image height
 * @param {object} config
 * @param {string[]} config.responseFields - Array of desired response fields. Possible values: ['asciiString', 'colorPixelMatrix'].
 * @param {boolean} config.shouldTraceEdges - If true, edges will be traced according to values specified.
 * @returns {object} result
 * @returns {string|undefined} result.asciiString - Large string containing ASCII version of the source image. Newline chars ('\n') represent the end of a row of pixels. Each character represents a pixel. Only returned if specified in config.responseFields.
 * @returns {string|undefined} result.pixelColorMatrix - 2D matrix containing ASCII version of the soource image. Dimension one represents row of pixels. Dimension two contains pixel's RGB values. Only returned if specified in config.responseFields.
 */
export default function trace(image, config) {
  const responseFields = config.responseFields || [];

  // destinations and cnotrol variables for pixel-wise operations during image traversal
  var asciiString = "";
  var colorPixelMatrix = [];
  let i = -1;

  // construct ascii string
  createPixelMap({
    imageData: image.data,
    width: image.width,
    onPixel: (px) => {
      let {
        rgb,
        rgbAverage,
        luminosity,
        perceivedLightness,
        gMagnitude,
        gAngle
      } = px;

      // ascii string processing
      if (responseFields.includes("asciiString")) {
        const edgeCharacter = config.edgeCharacter || "#";
        const shadingRamp = config.shadingRamp || ["*", "+", ";", ".", "`", ",", " "];
        const outline = () => edgeCharacter;
        const shade = () => perceivedLightness > 80 ? ' ' : shadingRamp[Math.floor(remap(perceivedLightness, 0, 100, 0, shadingRamp.length - 1))];
        const val = (config?.shouldTraceEdges && gMagnitude > config?.edgeDetectionThreshold) ? outline() : shade();
        asciiString += val;
      }

      // color pixel matrix processing
      if (responseFields.includes("colorPixelMatrix")) {
        colorPixelMatrix[i].push({ val: "*", rgb });
      }
    },
    onNewLine: () => {
      i++;
      
      // color pixel matrix processing
      if (responseFields.includes("colorPixelMatrix")) {
        colorPixelMatrix.push([]);
      }
    }
  });

  var returnObject = {};

  if (responseFields.includes("asciiString"))
    returnObject.asciiString = asciiString;
  if (responseFields.includes("colorPixelMatrix"))
    returnObject.colorPixelMatrix = colorPixelMatrix;

  return returnObject;
}