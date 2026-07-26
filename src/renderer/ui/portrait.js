/** Shared pilot portrait helpers (Character sheet + Create Pilot). */

const PORTRAIT_MAX_PX = 384

/** @param {File|Blob} file */
export function isPortraitImageFile(file) {
  if (!file) return false
  return (
    /image\/(png|jpeg|jpg)/i.test(file.type) ||
    /\.(png|jpe?g)$/i.test(file.name || '')
  )
}

/**
 * Center-crop resize to a square JPEG data URL (saves space in game saves).
 * @param {File|Blob} file
 * @returns {Promise<string>}
 */
export function resizeImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const size = PORTRAIT_MAX_PX
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        const sw = img.naturalWidth || img.width
        const sh = img.naturalHeight || img.height
        const scale = Math.max(size / sw, size / sh)
        const dw = sw * scale
        const dh = sh * scale
        ctx.fillStyle = '#0a1018'
        ctx.fillRect(0, 0, size, size)
        ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
        URL.revokeObjectURL(url)
        resolve(dataUrl)
      } catch (err) {
        URL.revokeObjectURL(url)
        reject(err)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not load image'))
    }
    img.src = url
  })
}
