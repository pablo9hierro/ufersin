// Deriva um trio de cores de acento harmonizado a partir de 1-2 cores
// escolhidas pelo lojista ("cor da sua loja"). Em vez de despejar a cor
// crua direto nas variáveis (o que quebrava contraste/gradiente no
// sistema antigo -- ver DemoPaletteSwitcher), aqui a cor é normalizada
// pra uma faixa de saturação/luminância que sempre funciona como acento
// de UI, e a 2ª/3ª cor (quando não informadas) são derivadas por rotação
// de matiz ANÁLOGA (+35°), nunca um salto pra matiz oposta -- é a mesma
// regra "gradiente só entre vizinhos" usada em uiux2/uiux3/theme.css.

interface Rgb {
  r: number
  g: number
  b: number
}

interface Hsl {
  h: number
  s: number
  l: number
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  }
}

function rgbToHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === rn) h = 60 * (((gn - bn) / d) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / d + 2)
    else h = 60 * ((rn - gn) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s, l }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

// Normaliza qualquer cor escolhida (pode vir muito clara, muito escura
// ou dessaturada de um input type=color livre) pra uma faixa que sempre
// lê bem como acento de UI: saturação alta o bastante pra não parecer
// "lavada", luminância numa faixa média (nem quase-branco nem quase-preto).
function normalize(hsl: Hsl): Hsl {
  return { h: hsl.h, s: clamp(hsl.s, 0.45, 0.92), l: clamp(hsl.l, 0.4, 0.62) }
}

export interface AccentTrio {
  accent1: string
  accent2: string
  accent3: string
}

export function deriveAccentTrio(color1: string, color2?: string | null): AccentTrio {
  const hsl1 = normalize(rgbToHsl(hexToRgb(color1)))
  const hsl2 = color2 ? normalize(rgbToHsl(hexToRgb(color2))) : { ...hsl1, h: (hsl1.h + 35) % 360 }
  const hsl3 = { ...hsl2, h: (hsl2.h + 35) % 360, l: clamp(hsl2.l + 0.05, 0.4, 0.66) }
  return {
    accent1: rgbToHex(hslToRgb(hsl1)),
    accent2: rgbToHex(hslToRgb(hsl2)),
    accent3: rgbToHex(hslToRgb(hsl3)),
  }
}
