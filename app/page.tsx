"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Upload, Download, RotateCcw } from "lucide-react"

const LABELS = [
  ["1", "Top Left"],
  ["2", "Top Center"],
  ["3", "Top Right"],
  ["4", "Mid Left"],
  ["5", "Mid Center"],
  ["6", "Mid Right"],
  ["7", "Bot Left"],
  ["8", "Bot Center"],
  ["9", "Bot Right"],
]

interface CellData {
  dataUrl: string
  row: number
  col: number
  idx: number
}

export default function ImageSplitter() {
  const [isDragOver, setIsDragOver] = useState(false)
  const [autoCrop, setAutoCrop] = useState(true)
  const [cells, setCells] = useState<CellData[]>([])
  const [showResult, setShowResult] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  const detectCropBounds = useCallback(
    (img: HTMLImageElement): { x: number; y: number; w: number; h: number } => {
      const T = 25
      const c = document.createElement("canvas")
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext("2d")!
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data

      const isDark = (x: number, y: number) => {
        const i = (y * c.width + x) * 4
        return d[i] < T && d[i + 1] < T && d[i + 2] < T
      }

      const rowDark = (y: number) => {
        for (let x = 0; x < c.width; x++) if (!isDark(x, y)) return false
        return true
      }

      const colDark = (x: number) => {
        for (let y = 0; y < c.height; y++) if (!isDark(x, y)) return false
        return true
      }

      let t = 0,
        b = c.height - 1,
        l = 0,
        r = c.width - 1
      while (t < b && rowDark(t)) t++
      while (b > t && rowDark(b)) b--
      while (l < r && colDark(l)) l++
      while (r > l && colDark(r)) r--

      return { x: l, y: t, w: r - l + 1, h: b - t + 1 }
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

      let sx = 0,
        sy = 0,
        sw = img.naturalWidth,
        sh = img.naturalHeight

      if (autoCrop) {
        const b = detectCropBounds(img)
        sx = b.x
        sy = b.y
        sw = b.w
        sh = b.h
      }

      const cw = Math.floor(sw / 3)
      const ch = Math.floor(sh / 3)

      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const idx = row * 3 + col
          const dataUrl = cropCanvas(img, sx + col * cw, sy + row * ch, cw, ch)
          newCells.push({ dataUrl, row, col, idx })
        }
      }

      setCells(newCells)
      setShowResult(true)
    },
    [autoCrop, detectCropBounds, cropCanvas]
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

  const downloadAll = () => {
    cells.forEach((cell, i) => {
      setTimeout(() => {
        downloadDataUrl(cell.dataUrl, `panel_${cell.idx + 1}.png`)
      }, i * 250)
    })
  }

  const downloadComposite = () => {
    if (!cells.length) return

    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const cw = img.width
      const ch = img.height
      const L = 4
      const comp = document.createElement("canvas")
      comp.width = cw * 3 + L * 2
      comp.height = ch * 3 + L * 2
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
          if (loaded === 9) {
            downloadDataUrl(comp.toDataURL("image/png"), "grid_composite.png")
          }
        }
        cellImg.src = cell.dataUrl
      })
    }
    img.src = cells[0].dataUrl
  }

  const reset = () => {
    setShowResult(false)
    setCells([])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <main className="min-h-screen bg-background flex flex-col items-center px-5 py-10 pb-20 font-sans text-foreground">
      <h1 className="text-xl font-light tracking-[0.15em] uppercase mb-1.5">
        9-Grid Splitter
      </h1>
      <p className="text-[0.72rem] text-muted-foreground tracking-[0.2em] mb-9">
        Upload any image — split into 9 equal parts
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

          <div className="flex items-center gap-2.5 mt-4 text-[0.72rem] text-muted-foreground tracking-[0.1em] justify-center">
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
        </>
      )}

      {showResult && (
        <div
          ref={resultRef}
          className="flex flex-col items-center w-full max-w-[860px] mt-12"
        >
          <p className="text-[0.62rem] tracking-[0.35em] uppercase text-muted-foreground/50 mb-3.5 self-start">
            Grid Preview
          </p>
          <div className="w-full max-w-[560px] bg-background p-0.5 grid grid-cols-3 gap-0.5 self-center overflow-hidden isolate">
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
            All 9 Panels Separately
          </p>
          <p className="text-[0.68rem] text-muted-foreground/50 tracking-[0.18em] mb-6 self-start">
            Each image individually cut from the grid
          </p>

          <div className="w-full grid grid-cols-3 gap-4.5">
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
                      Panel {LABELS[cell.idx][0]}
                    </strong>
                    {LABELS[cell.idx][1]}
                  </div>
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
            ))}
          </div>

          <div className="flex gap-3 mt-10 flex-wrap justify-center">
            <button
              onClick={downloadAll}
              className="py-3 px-6 rounded-lg text-[0.75rem] tracking-[0.15em] uppercase cursor-pointer border-none font-sans transition-all hover:-translate-y-0.5 hover:opacity-90 bg-foreground text-background font-semibold flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download All 9
            </button>
            <button
              onClick={downloadComposite}
              className="py-3 px-6 rounded-lg text-[0.75rem] tracking-[0.15em] uppercase cursor-pointer font-sans transition-all hover:-translate-y-0.5 hover:opacity-90 bg-btn-tertiary text-muted-foreground border border-btn-tertiary-border flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download Grid
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
