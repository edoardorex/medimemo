export async function createScanner() {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const hints = new Map([
    [DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.CODE_128,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
    ]],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 250 });
}

export function stopVideo(video) {
  if (video.srcObject) {
    for (const track of video.srcObject.getTracks()) track.stop();
    video.srcObject = null;
  }
}

export function cameraError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') return 'Camera permission was denied. Allow camera access in your browser, or enter the details manually.';
  if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') return 'No camera found. You can still add your medicine manually.';
  if (error.name === 'NotReadableError') return 'The camera is busy or unavailable. Close other camera apps and try again.';
  return `Could not start the camera: ${error.message || 'unknown error'}. You can enter the details manually.`;
}
