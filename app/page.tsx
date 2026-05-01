"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Upload, Download, RotateCcw, Copy, Check, Crop } from "lucide-react"

interface CellData {
  dataUrl: string
  row: number
  col: number
  idx: number
}

interface GridInfo {
  rows: number
  cols: number
  rowBounds: number[]
  colBounds: number[]
}

function getLabel(row: number, col: number, rows: number, cols: number): [string, string] {
  const idx = row * cols + col + 1
  const rowLabel = rows === 1 ? "" : rows === 2 ? (row === 0 ? "Top" : "Bot") : row === 0 ? "Top" : row === rows - 1 ? "Bot" : "Mid"
  const colLabel = cols === 1 ? "" : cols === 2 ? (col === 0 ? "Left" : "Right") : col === 0 ? "Left" : col === cols - 1 ? "Right" : "Center"
  const position = [rowLabel, colLabel].filter(Boolean).join(" ") || "Center"
  return [String(idx), position]
}

export default function ImageSplitter() {
  const [isDragOver, setIsDragOver] = useState(false)
  const [autoCrop, setAutoCrop] = useState(true)
  const [autoDetectGrid, setAutoDetectGrid] = useState(true)
  const [cells, setCells] = useState<CellData[]>([])
  const [gridInfo, setGridInfo] = useState<GridInfo>({ rows: 3, cols: 3, rowBounds: [], colBounds: [] })
  const [showResult, setShowResult] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedPanel, setCopiedPanel] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  const getImageData = useCallback((img: HTMLImageElement) => {
    const c = document.createElement("canvas")
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext("2d")!
    ctx.drawImage(img, 0, 0)
    return { canvas: c, ctx, data: ctx.getImageData(0, 0, c.width, c.height).data }
  }, [])

  const detectCropBounds = useCallback(
    (img: HTMLImageElement, imgData: Uint8ClampedArray, width: number, height: number): { x: number; y: number; w: number; h: number } => {
      const T = 25

      const isDark = (x: number, y: number) => {
        const i = (y * width + x) * 4
        return imgData[i] < T && imgData[i + 1] < T && imgData[i + 2] < T
      }

      const rowDark = (y: number) => {
        for (let x = 0; x < width; x++) if (!isDark(x, y)) return false
        return true
      }

      const colDark = (x: number) => {
        for (let y = 0; y < height; y++) if (!isDark(x, y)) return false
        return true
      }

      let t = 0,
        b = height - 1,
        l = 0,
        r = width - 1
      while (t < b && rowDark(t)) t++
      while (b > t && rowDark(b)) b--
      while (l < r && colDark(l)) l++
      while (r > l && colDark(r)) r--

      return { x: l, y: t, w: r - l + 1, h: b - t + 1 }
    },
    []
  )

  const detectGridLines = useCallback(
    (imgData: Uint8ClampedArray, width: number, height: number, bounds: { x: number; y: number; w: number; h: number }): GridInfo => {
      const { x: bx, y: by, w: bw, h: bh } = bounds
      const TOLERANCE = 35
      const MIN_LINE_WIDTH = 2
      const MIN_PANEL_SIZE = 50

      // Check if a row/col is a uniform separator line (black, white, or gray)
      const isUniformLine = (pixels: number[][]) => {
        if (pixels.length === 0) return false
        const first = pixels[0]
        const isUniform = pixels.every(p => 
          Math.abs(p[0] - first[0]) < TOLERANCE &&
          Math.abs(p[1] - first[1]) < TOLERANCE &&
          Math.abs(p[2] - first[2]) < TOLERANCE
        )
        if (!isUniform) return false
        
        // Check if it's a neutral color (black, white, or gray)
        const avg = (first[0] + first[1] + first[2]) / 3
        const isNeutral = Math.abs(first[0] - avg) < 30 && Math.abs(first[1] - avg) < 30 && Math.abs(first[2] - avg) < 30
        return isNeutral
      }

      const getRowPixels = (y: number) => {
        const pixels: number[][] = []
        for (let x = bx; x < bx + bw; x += Math.max(1, Math.floor(bw / 100))) {
          const i = (y * width + x) * 4
          pixels.push([imgData[i], imgData[i + 1], imgData[i + 2]])
        }
        return pixels
      }

      const getColPixels = (x: number) => {
        const pixels: number[][] = []
        for (let y = by; y < by + bh; y += Math.max(1, Math.floor(bh / 100))) {
          const i = (y * width + x) * 4
          pixels.push([imgData[i], imgData[i + 1], imgData[i + 2]])
        }
        return pixels
      }

      // Find horizontal separator lines
      const hLines: number[] = []
      let inLine = false
      let lineStart = 0
      for (let y = by + MIN_PANEL_SIZE; y < by + bh - MIN_PANEL_SIZE; y++) {
        if (isUniformLine(getRowPixels(y))) {
          if (!inLine) {
            inLine = true
            lineStart = y
          }
        } else {
          if (inLine && y - lineStart >= MIN_LINE_WIDTH) {
            hLines.push(Math.floor((lineStart + y) / 2))
          }
          inLine = false
        }
      }

      // Find vertical separator lines
      const vLines: number[] = []
      inLine = false
      lineStart = 0
      for (let x = bx + MIN_PANEL_SIZE; x < bx + bw - MIN_PANEL_SIZE; x++) {
        if (isUniformLine(getColPixels(x))) {
          if (!inLine) {
            inLine = true
            lineStart = x
          }
        } else {
          if (inLine && x - lineStart >= MIN_LINE_WIDTH) {
            vLines.push(Math.floor((lineStart + x) / 2))
          }
          inLine = false
        }
      }

      // Filter out lines that are too close together
      const filterCloseLines = (lines: number[], minDist: number) => {
        if (lines.length === 0) return []
        const filtered = [lines[0]]
        for (let i = 1; i < lines.length; i++) {
          if (lines[i] - filtered[filtered.length - 1] > minDist) {
            filtered.push(lines[i])
          }
        }
        return filtered
      }

      const filteredHLines = filterCloseLines(hLines, MIN_PANEL_SIZE)
      const filteredVLines = filterCloseLines(vLines, MIN_PANEL_SIZE)

      const rows = filteredHLines.length + 1
      const cols = filteredVLines.length + 1

      // Create bounds arrays
      const rowBounds = [by, ...filteredHLines, by + bh]
      const colBounds = [bx, ...filteredVLines, bx + bw]

      return { rows, cols, rowBounds, colBounds }
    },
    []
  )

  const cropCanvas = useCallback(
    (
      img: HTMLImageElement,
      sx: number,
      sy: number,
      sw: number,
      sh: number
    ): string => {
      const c = document.createElement("canvas")
      c.width = sw
      c.height = sh
      c.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      return c.toDataURL("image/png")
    },
    []
  )

  const splitImage = useCallback(
    (img: HTMLImageElement) => {
      const newCells: CellData[] = []
      const { data, canvas } = getImageData(img)
      const width = canvas.width
      const height = canvas.height

      // Get crop bounds first
      let bounds = { x: 0, y: 0, w: width, h: height }
      if (autoCrop) {
        bounds = detectCropBounds(img, data, width, height)
      }

      let grid: GridInfo

      if (autoDetectGrid) {
        // Auto-detect grid from separator lines
        grid = detectGridLines(data, width, height, bounds)
        
        // Fall back to 3x3 if no lines detected
        if (grid.rows === 1 && grid.cols === 1) {
          grid = {
            rows: 3,
            cols: 3,
            rowBounds: [bounds.y, bounds.y + Math.floor(bounds.h / 3), bounds.y + Math.floor(bounds.h * 2 / 3), bounds.y + bounds.h],
            colBounds: [bounds.x, bounds.x + Math.floor(bounds.w / 3), bounds.x + Math.floor(bounds.w * 2 / 3), bounds.x + bounds.w]
          }
        }
      } else {
        // Default 3x3 grid
        grid = {
          rows: 3,
          cols: 3,
          rowBounds: [bounds.y, bounds.y + Math.floor(bounds.h / 3), bounds.y + Math.floor(bounds.h * 2 / 3), bounds.y + bounds.h],
          colBounds: [bounds.x, bounds.x + Math.floor(bounds.w / 3), bounds.x + Math.floor(bounds.w * 2 / 3), bounds.x + bounds.w]
        }
      }

      setGridInfo(grid)

      // Extract each cell based on detected bounds
      for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
          const idx = row * grid.cols + col
          const x = grid.colBounds[col]
          const y = grid.rowBounds[row]
          const w = grid.colBounds[col + 1] - x
          const h = grid.rowBounds[row + 1] - y
          
          // Skip the separator line pixels (trim a few pixels from edges)
          const trim = 2
          const dataUrl = cropCanvas(img, x + trim, y + trim, w - trim * 2, h - trim * 2)
          newCells.push({ dataUrl, row, col, idx })
        }
      }

      setCells(newCells)
      setShowResult(true)
    },
    [autoCrop, autoDetectGrid, detectCropBounds, detectGridLines, cropCanvas, getImageData]
  )

  const processFile = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => splitImage(img)
        img.src = e.target?.result as string
      }
      reader.readAsDataURL(file)
    },
    [splitImage]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const f = e.dataTransfer.files[0]
      if (f && f.type.startsWith("image/")) processFile(f)
    },
    [processFile]
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) processFile(e.target.files[0])
    },
    [processFile]
  )

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile()
          if (file) processFile(file)
          break
        }
      }
    }
    document.addEventListener("paste", handlePaste)
    return () => document.removeEventListener("paste", handlePaste)
  }, [processFile])

  useEffect(() => {
    if (showResult && resultRef.current) {
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth" })
      }, 60)
    }
  }, [showResult])

  const downloadDataUrl = (dataUrl: string, name: string) => {
    const a = document.createElement("a")
    a.download = name
    a.href = dataUrl
    a.click()
  }

  const cropWhitespace = useCallback((cellIdx: number) => {
    const cell = cells.find(c => c.idx === cellIdx)
    if (!cell) return

    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext("2d")!
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data
      const width = canvas.width
      const height = canvas.height

      // Threshold for considering a pixel as "light/white"
      const LIGHT_THRESHOLD = 240

      const isLight = (x: number, y: number) => {
        const i = (y * width + x) * 4
        return data[i] > LIGHT_THRESHOLD && data[i + 1] > LIGHT_THRESHOLD && data[i + 2] > LIGHT_THRESHOLD
      }

      const rowLight = (y: number) => {
        for (let x = 0; x < width; x++) if (!isLight(x, y)) return false
        return true
      }

      const colLight = (x: number) => {
        for (let y = 0; y < height; y++) if (!isLight(x, y)) return false
        return true
      }

      let t = 0, b = height - 1, l = 0, r = width - 1
      while (t < b && rowLight(t)) t++
      while (b > t && rowLight(b)) b--
      while (l < r && colLight(l)) l++
      while (r > l && colLight(r)) r--

      // If no cropping needed (no whitespace found), return early
      if (t === 0 && b === height - 1 && l === 0 && r === width - 1) return

      const newWidth = r - l + 1
      const newHeight = b - t + 1

      const croppedCanvas = document.createElement("canvas")
      croppedCanvas.width = newWidth
      croppedCanvas.height = newHeight
      croppedCanvas.getContext("2d")!.drawImage(
        canvas, l, t, newWidth, newHeight, 0, 0, newWidth, newHeight
      )

      const newDataUrl = croppedCanvas.toDataURL("image/png")
      
      setCells(prevCells => 
        prevCells.map(c => 
          c.idx === cellIdx ? { ...c, dataUrl: newDataUrl } : c
        )
      )
    }
    img.src = cell.dataUrl
  }, [cells])

  const downloadAll = () => {
    cells.forEach((cell, i) => {
      setTimeout(() => {
        downloadDataUrl(cell.dataUrl, `panel_${cell.idx + 1}.png`)
      }, i * 250)
    })
  }

  const copyToClipboard = useCallback(async (dataUrl: string, panelIdx?: number) => {
    try {
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ])
      if (panelIdx !== undefined) {
        setCopiedPanel(panelIdx)
        setTimeout(() => setCopiedPanel(null), 2000)
      }
      return true
    } catch (err) {
      console.error("Failed to copy to clipboard:", err)
      return false
    }
  }, [])

  const copyAllToClipboard = useCallback(async () => {
    if (!cells.length) return

    try {
      // Convert all data URLs to blobs
      const blobs = await Promise.all(
        cells.map(async (cell) => {
          const response = await fetch(cell.dataUrl)
          return response.blob()
        })
      )

      // Create clipboard items for each image
      const clipboardItems = blobs.map(
        (blob) => new ClipboardItem({ [blob.type]: blob })
      )

      // Note: Most browsers only support writing one item at a time
      // So we'll copy just the first image and show a message
      // For full support, we create a composite image instead
      
      // Create a composite canvas with all images
      const firstImg = new Image()
      firstImg.crossOrigin = "anonymous"
      
      await new Promise<void>((resolve) => {
        firstImg.onload = async () => {
          const cw = firstImg.width
          const ch = firstImg.height
          const L = 4
          const comp = document.createElement("canvas")
          comp.width = cw * gridInfo.cols + L * (gridInfo.cols - 1)
          comp.height = ch * gridInfo.rows + L * (gridInfo.rows - 1)
          const ctx = comp.getContext("2d")!
          ctx.fillStyle = "#111"
          ctx.fillRect(0, 0, comp.width, comp.height)

          let loaded = 0
          await Promise.all(
            cells.map(
              (cell) =>
                new Promise<void>((imgResolve) => {
                  const cellImg = new Image()
                  cellImg.crossOrigin = "anonymous"
                  cellImg.onload = () => {
                    ctx.drawImage(
                      cellImg,
                      cell.col * (cw + L),
                      cell.row * (ch + L),
                      cw,
                      ch
                    )
                    loaded++
                    imgResolve()
                  }
                  cellImg.src = cell.dataUrl
                })
            )
          )

          // Convert canvas to blob and copy to clipboard
          comp.toBlob(async (blob) => {
            if (blob) {
              await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob }),
              ])
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }
            resolve()
          }, "image/png")
        }
        firstImg.src = cells[0].dataUrl
      })
    } catch (err) {
      console.error("Failed to copy to clipboard:", err)
      // Fallback: try to copy just the first image
      try {
        const response = await fetch(cells[0].dataUrl)
        const blob = await response.blob()
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob }),
        ])
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (fallbackErr) {
        console.error("Fallback copy also failed:", fallbackErr)
      }
    }
  }, [cells, gridInfo])

  const downloadComposite = useCallback(() => {
    if (!cells.length) return

    // Get dimensions from first cell
    const firstImg = new Image()
    firstImg.crossOrigin = "anonymous"
    firstImg.onload = () => {
      const cw = firstImg.width
      const ch = firstImg.height
      const L = 4
      const comp = document.createElement("canvas")
      comp.width = cw * gridInfo.cols + L * (gridInfo.cols - 1)
      comp.height = ch * gridInfo.rows + L * (gridInfo.rows - 1)
      const ctx = comp.getContext("2d")!
      ctx.fillStyle = "#111"
      ctx.fillRect(0, 0, comp.width, comp.height)

      let loaded = 0
      cells.forEach((cell) => {
        const cellImg = new Image()
        cellImg.crossOrigin = "anonymous"
        cellImg.onload = () => {
          ctx.drawImage(
            cellImg,
            cell.col * (cw + L),
            cell.row * (ch + L),
            cw,
            ch
          )
          loaded++
          if (loaded === cells.length) {
            downloadDataUrl(comp.toDataURL("image/png"), "grid_composite.png")
          }
        }
        cellImg.src = cell.dataUrl
      })
    }
    firstImg.src = cells[0].dataUrl
  }, [cells, gridInfo])

  const reset = () => {
    setShowResult(false)
    setCells([])
    setCopied(false)
    setCopiedPanel(null)
    setGridInfo({ rows: 3, cols: 3, rowBounds: [], colBounds: [] })
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <main className="min-h-screen bg-background flex flex-col items-center px-5 py-10 pb-20 font-sans text-foreground">
      <h1 className="text-xl font-light tracking-[0.15em] uppercase mb-1.5">
        Image Grid Splitter
      </h1>
      <p className="text-[0.72rem] text-muted-foreground tracking-[0.2em] mb-9">
        Upload any image — auto-detects grid or splits into 9 equal parts
      </p>

      {!showResult && (
        <>
          <div
            className={`w-full max-w-[520px] border-2 border-dashed rounded-2xl py-13 px-6 text-center cursor-pointer transition-all relative ${
              isDragOver
                ? "border-foreground bg-card-hover"
                : "border-border bg-card"
            } hover:border-foreground hover:bg-card-hover`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <span className="text-[2.8rem] mb-3 block">
              <Upload className="w-11 h-11 mx-auto text-muted-foreground" />
            </span>
            <p className="text-[0.95rem] text-muted-foreground/80 mb-2">
              Click or drag & drop your image here
            </p>
            <span className="text-[0.72rem] text-muted-foreground/50">
              JPG · PNG · WEBP &nbsp;·&nbsp; or{" "}
              <kbd className="bg-kbd border border-kbd-border rounded px-1.5 py-0.5 text-[0.68rem] font-mono text-muted-foreground/60">
                Ctrl+V
              </kbd>{" "}
              /{" "}
              <kbd className="bg-kbd border border-kbd-border rounded px-1.5 py-0.5 text-[0.68rem] font-mono text-muted-foreground/60">
                ⌘V
              </kbd>{" "}
              to paste
            </span>
          </div>

          <div className="flex flex-col gap-2.5 mt-4 text-[0.72rem] text-muted-foreground tracking-[0.1em] items-center">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                id="autoDetectGrid"
                checked={autoDetectGrid}
                onChange={(e) => setAutoDetectGrid(e.target.checked)}
                className="accent-foreground w-3.5 h-3.5 cursor-pointer"
              />
              <label htmlFor="autoDetectGrid" className="cursor-pointer select-none">
                Auto-detect grid from separator lines
              </label>
            </div>
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                id="autoCrop"
                checked={autoCrop}
                onChange={(e) => setAutoCrop(e.target.checked)}
                className="accent-foreground w-3.5 h-3.5 cursor-pointer"
              />
              <label htmlFor="autoCrop" className="cursor-pointer select-none">
                Auto-remove black borders before splitting
              </label>
            </div>
          </div>
        </>
      )}

      {showResult && (
        <div
          ref={resultRef}
          className="flex flex-col items-center w-full max-w-[860px] mt-12"
        >
          <p className="text-[0.62rem] tracking-[0.35em] uppercase text-muted-foreground/50 mb-3.5 self-start">
            Grid Preview ({gridInfo.rows} x {gridInfo.cols})
          </p>
          <div 
            className="w-full max-w-[560px] bg-background p-0.5 grid gap-0.5 self-center overflow-hidden isolate"
            style={{ gridTemplateColumns: `repeat(${gridInfo.cols}, 1fr)` }}
          >
            {cells.map((cell) => (
              <div
                key={cell.idx}
                className="overflow-hidden block leading-[0] bg-background"
              >
                <img
                  src={cell.dataUrl}
                  alt={`Grid cell ${cell.idx + 1}`}
                  className="block w-full h-auto pointer-events-none align-top"
                />
              </div>
            ))}
          </div>

          <div className="w-full h-px bg-gradient-to-r from-transparent via-border to-transparent my-12" />

          <p className="text-base font-light tracking-[0.12em] uppercase text-muted-foreground/80 mb-1 self-start">
            All {cells.length} Panels Separately
          </p>
          <p className="text-[0.68rem] text-muted-foreground/50 tracking-[0.18em] mb-6 self-start">
            Each image individually cut from the grid
          </p>

          <div 
            className="w-full grid gap-4.5"
            style={{ gridTemplateColumns: `repeat(${Math.min(gridInfo.cols, 4)}, 1fr)` }}
          >
            {cells.map((cell, i) => (
              <div
                key={cell.idx}
                className="bg-card border border-panel-border rounded-lg overflow-hidden flex flex-col transition-all hover:border-panel-border-hover hover:-translate-y-0.5 animate-fade-up"
                style={{ animationDelay: `${i * 0.04}s` }}
              >
                <div className="w-full overflow-hidden leading-[0] bg-black flex-shrink-0">
                  <img
                    src={cell.dataUrl}
                    alt={`Panel ${cell.idx + 1}`}
                    className="block w-full h-auto align-top pointer-events-none"
                  />
                </div>
                <div className="flex items-center justify-between py-2.5 px-3 border-t border-panel-footer-border flex-shrink-0 bg-card">
                  <div className="text-[0.66rem] text-muted-foreground/60 tracking-[0.08em] uppercase leading-relaxed">
                    <strong className="text-muted-foreground block font-semibold text-[0.76rem]">
                      Panel {getLabel(cell.row, cell.col, gridInfo.rows, gridInfo.cols)[0]}
                    </strong>
                    {getLabel(cell.row, cell.col, gridInfo.rows, gridInfo.cols)[1]}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => cropWhitespace(cell.idx)}
                      title="Auto-crop whitespace"
                      className="bg-btn-secondary border border-btn-secondary-border text-muted-foreground/70 text-[0.62rem] tracking-[0.15em] uppercase py-1.5 px-2 rounded-md cursor-pointer font-sans whitespace-nowrap transition-all hover:bg-foreground hover:text-background hover:border-foreground flex items-center gap-1"
                    >
                      <Crop className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => copyToClipboard(cell.dataUrl, cell.idx)}
                      title="Copy to clipboard"
                      className={`border text-[0.62rem] tracking-[0.15em] uppercase py-1.5 px-2 rounded-md cursor-pointer font-sans whitespace-nowrap transition-all flex items-center gap-1 ${
                        copiedPanel === cell.idx
                          ? "bg-green-600 text-foreground border-green-600"
                          : "bg-btn-secondary border-btn-secondary-border text-muted-foreground/70 hover:bg-foreground hover:text-background hover:border-foreground"
                      }`}
                    >
                      {copiedPanel === cell.idx ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                    <button
                      onClick={() =>
                        downloadDataUrl(cell.dataUrl, `panel_${cell.idx + 1}.png`)
                      }
                      className="bg-btn-secondary border border-btn-secondary-border text-muted-foreground/70 text-[0.62rem] tracking-[0.15em] uppercase py-1.5 px-3 rounded-md cursor-pointer font-sans whitespace-nowrap transition-all hover:bg-foreground hover:text-background hover:border-foreground"
                    >
                      ↓ Save
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 mt-10 flex-wrap justify-center">
            <button
              onClick={downloadAll}
              className="py-3 px-6 rounded-lg text-[0.75rem] tracking-[0.15em] uppercase cursor-pointer border-none font-sans transition-all hover:-translate-y-0.5 hover:opacity-90 bg-foreground text-background font-semibold flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download All {cells.length}
            </button>
            <button
              onClick={async () => {
                for (let i = 0; i < cells.length; i++) {
                  await copyToClipboard(cells[i].dataUrl, cells[i].idx)
                  if (i < cells.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 300))
                  }
                }
              }}
              className="py-3 px-6 rounded-lg text-[0.75rem] tracking-[0.15em] uppercase cursor-pointer font-sans transition-all hover:-translate-y-0.5 hover:opacity-90 bg-foreground text-background font-semibold flex items-center gap-2"
            >
              <Copy className="w-4 h-4" />
              Copy All {cells.length}
            </button>
            <button
              onClick={downloadComposite}
              className="py-3 px-6 rounded-lg text-[0.75rem] tracking-[0.15em] uppercase cursor-pointer font-sans transition-all hover:-translate-y-0.5 hover:opacity-90 bg-btn-tertiary text-muted-foreground border border-btn-tertiary-border flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download Grid
            </button>
            <button
              onClick={copyAllToClipboard}
              className={`py-3 px-6 rounded-lg text-[0.75rem] tracking-[0.15em] uppercase cursor-pointer font-sans transition-all hover:-translate-y-0.5 hover:opacity-90 border flex items-center gap-2 ${
                copied 
                  ? "bg-green-600 text-foreground border-green-600" 
                  : "bg-btn-tertiary text-muted-foreground border-btn-tertiary-border"
              }`}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied!" : "Copy Grid"}
            </button>
            <button
              onClick={reset}
              className="py-3 px-6 rounded-lg text-[0.75rem] tracking-[0.15em] uppercase cursor-pointer font-sans transition-all hover:-translate-y-0.5 hover:opacity-90 bg-btn-reset text-muted-foreground/60 border border-btn-reset-border flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Upload New Image
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
